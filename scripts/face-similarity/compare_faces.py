#!/usr/bin/env python
"""人脸身份相似度：把一个"锚点"脸和若干张图里的脸做**同一人判断**。

为什么需要它：B103 片 B 已经用两张场景图证明"换场景换姿势还是同一张脸"，但那是**看图说话**
——PLAN 里明确写了"这是视觉判断，不是人脸相似度指标"。人眼会漏，而且下一版换了模型/工作流
之后没人能复跑。这里把判断变成**一个数字 + 一组可复现的命令**。

这个数字是什么（不要当百分比读）：
    ArcFace 人脸识别模型（InsightFace `buffalo_l` / `antelopev2`）输出的 512 维**归一化身份嵌入**
    之间的**余弦相似度**。它是"同一个人的可能性"的相对量，不是概率、不是百分比。
    本机实测（B103 那组图，合成人脸，见 scripts/face-similarity/README.md）：
    - 同一个人在不同场景/姿势：0.40 ~ 0.60（视模型而定）
    - 不同的人：0.16 ~ 0.49 —— **和同人区间重叠**，所以单阈值不能当判决
    这也是这个工具存在的主要价值：它会把"分不开"如实报出来，而不是给一个看起来专业的分数。

红线（"宁可没结论，也不给假结论"）：
    1. 图里没有人脸 → 这张图 `noFace`，不参与相似度，整体判定失败（code=1），**不用别的图代替**；
    2. 图里有多张脸 → 标 `ambiguous`，不当身份证据（挑最大的那张算，但明确告诉你这张不算数）；
    3. 阈值是**外部工作点**（ArcFace 常用 0.35），不是本项目标定出来的；所以要么同时给
       `--negatives`（不同人的图）把实测间隔打出来，要么在结论里写"未标定"；
    4. 依赖缺失（没装 insightface / 没模型）→ 直接退出码 2，打印装法，**不返回 0**，
       免得流水线把"没测"当成"通过"。

用法：
    python scripts/face-similarity/compare_faces.py \
        --anchor .tmp/e2e/anchor.png \
        --images .tmp/e2e/scene1.png .tmp/e2e/scene2.png \
        --negatives .tmp/e2e/other-person.png \
        --json .tmp/e2e/face-similarity.json

退出码：0 = 同人组全过阈值（给了对照图时异人组也全被排除）；
        1 = 有不同人 / noFace / ambiguous / **有误判**（最后这条等于"这把尺子在这组图上不可信"）；
        2 = 后端不可用（没装依赖 / 没下模型），**不当作通过**。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings
from dataclasses import dataclass, field

# Windows 控制台默认 GBK：中文会乱码，符号（⚠）会直接抛 UnicodeEncodeError 把结论截断。
# 统一按 UTF-8 写，出错也只降级成 '?'，不让"打印失败"变成"跑失败"。
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8', errors='replace')

# insightface 0.28 与 scikit-image 的 deprecation 噪声与结论无关，别让它盖住报告。
warnings.filterwarnings('ignore', message='.*estimate.*deprecated.*')

try:
    import numpy as np
    from PIL import Image
except ImportError as error:  # pragma: no cover - 环境问题，不是逻辑问题
    print(f'✗ 缺少依赖：{error}', file=sys.stderr)
    print('  见 scripts/face-similarity/README.md 的"一次性准备"', file=sys.stderr)
    sys.exit(2)

DEFAULT_MODEL_ROOT = os.path.join('.tmp', 'facesim-models')
DEFAULT_THRESHOLD = 0.35  # ArcFace 常用工作点；**不是**本项目标定的值（见 README）
# 换模型会换分布，所以模型名必须进报告：同一组图在两个模型上可能一个分得开、一个分不开。
DEFAULT_MODEL = 'buffalo_l'


@dataclass
class FaceResult:
    path: str
    face_count: int
    det_score: float
    bbox: list[int]
    face_ratio: float  # 脸框面积 / 全图面积，用来提醒"这张脸太小，det 靠猜"
    embedding: np.ndarray = field(repr=False, default=None)  # type: ignore[assignment]

    @property
    def ambiguous(self) -> bool:
        return self.face_count > 1

    @property
    def usable(self) -> bool:
        return self.face_count >= 1


def load_bgr(path: str) -> np.ndarray:
    """读成 BGR ndarray —— 不直接用 cv2.imread，它对非 ASCII 路径会静默返回 None。"""
    with Image.open(path) as image:
        rgb = np.asarray(image.convert('RGB'))
    return rgb[:, :, ::-1].copy()


def build_app(model_root: str, model_name: str = DEFAULT_MODEL):
    try:
        from insightface.app import FaceAnalysis
    except ImportError as error:  # pragma: no cover
        print(f'✗ 没装上 insightface：{error}', file=sys.stderr)
        print('  见 scripts/face-similarity/README.md 的"一次性准备"', file=sys.stderr)
        sys.exit(2)

    models_path = os.path.join(model_root, 'models', model_name)
    if not os.path.isdir(models_path):
        print(f'✗ 模型不在：{models_path}', file=sys.stderr)
        print('  见 scripts/face-similarity/README.md 的"一次性准备"（要下模型包里的 onnx）', file=sys.stderr)
        sys.exit(2)

    app = FaceAnalysis(root=model_root, name=model_name, providers=['CPUExecutionProvider'])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    return app


def analyse(app, path: str) -> FaceResult:
    image = load_bgr(path)
    height, width = image.shape[:2]
    faces = list(app.get(image))
    if not faces:
        return FaceResult(path=path, face_count=0, det_score=0.0, bbox=[], face_ratio=0.0)

    # 多张脸时按面积取最大 —— 但要记住"这张图有 N 张脸"，那意味着它不能当身份证据。
    def area(face) -> float:
        x1, y1, x2, y2 = face.bbox
        return max(0.0, float(x2 - x1)) * max(0.0, float(y2 - y1))

    faces.sort(key=area, reverse=True)
    face = faces[0]
    x1, y1, x2, y2 = [int(round(float(value))) for value in face.bbox]
    return FaceResult(
        path=path,
        face_count=len(faces),
        det_score=float(face.det_score),
        bbox=[x1, y1, x2, y2],
        face_ratio=area(face) / float(width * height),
        embedding=face.normed_embedding,
    )


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.dot(left, right))


def short(path: str) -> str:
    """报告里用短名：完整路径太长，表格读不了。重名时保留末两级。"""
    return os.path.basename(path)


def fmt(value: float | None) -> str:
    return '—' if value is None else f'{value:.4f}'


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description='人脸身份相似度（ArcFace 余弦）')
    parser.add_argument('--anchor', required=True, help='锚点图（定妆图）路径')
    parser.add_argument('--images', nargs='+', required=True, help='要比对的图（每条本该是同一个人）')
    parser.add_argument('--negatives', nargs='*', default=[], help='不同人的对照图，用来把刻度打出来')
    parser.add_argument('--threshold', type=float, default=DEFAULT_THRESHOLD, help='判定同人的余弦阈值')
    parser.add_argument('--model-root', default=DEFAULT_MODEL_ROOT, help='模型根目录（其下有 models/<name>）')
    parser.add_argument('--model', default=DEFAULT_MODEL, help='模型包名：buffalo_l（R50）/ antelopev2（R100）')
    parser.add_argument('--json', default='', help='把结果写到这个 JSON 文件')
    args = parser.parse_args(argv)

    paths = [args.anchor, *args.images, *args.negatives]
    missing = [path for path in paths if not os.path.isfile(path)]
    if missing:
        print(f'✗ 文件不存在：{", ".join(missing)}', file=sys.stderr)
        return 1

    app = build_app(args.model_root, args.model)
    results = {path: analyse(app, path) for path in paths}
    anchor = results[args.anchor]

    print(f'模型：InsightFace {args.model}（ArcFace 512 维归一化嵌入），provider=CPU')
    print(f'阈值：cos ≥ {args.threshold:.2f} 判同人（外部工作点，非本项目标定）')
    print('')
    print(f'锚点：{short(args.anchor)}  脸={anchor.face_count}  det={anchor.det_score:.3f}  占图={anchor.face_ratio:.1%}')

    if not anchor.usable:
        print('✗ 锚点图里没检测到人脸 —— 没有可比的东西，不做任何相似度结论', file=sys.stderr)
        return 1

    def report(label: str, path: str, *, expect_same: bool) -> dict:
        item = results[path]
        verdict = 'noFace'
        score = None
        if item.usable:
            score = cosine(anchor.embedding, item.embedding)
            if item.ambiguous:
                verdict = 'ambiguous'
            elif expect_same:
                verdict = 'same' if score >= args.threshold else 'different'
            else:
                verdict = 'negative' if score < args.threshold else 'negative-too-close'
        print(
            f'  [{label}] {short(path):<34} 脸={item.face_count}  det={item.det_score:.3f}  '
            f'占图={item.face_ratio:.1%}  cos={fmt(score)}  → {verdict}'
        )
        return {
            'label': label,
            'path': path,
            'faceCount': item.face_count,
            'detScore': round(item.det_score, 4),
            'faceRatio': round(item.face_ratio, 4),
            'bbox': item.bbox,
            'cosine': None if score is None else round(score, 4),
            'verdict': verdict,
        }

    print('')
    subject_rows = [report('subject', path, expect_same=True) for path in args.images]
    negative_rows = [report('negative', path, expect_same=False) for path in args.negatives]

    # ── 两条分布，而不是"一个锚点对所有人" ──
    # 只看"锚点 vs 每张图"会漏掉一个事实：锚点是棚拍定妆图、场景图是电影感剧照（脸更小、角度更斜），
    # 两者的落差里混着"同一个人的不同拍法"。所以同人组里也要算 **subject ↔ subject**（场景图之间）。
    same_group = [args.anchor, *args.images]
    pairs: list[dict] = []

    def add_pair(left: str, right: str, kind: str) -> None:
        if not results[left].usable or not results[right].usable:
            return
        score = cosine(results[left].embedding, results[right].embedding)
        pairs.append(
            {
                'a': left,
                'b': right,
                'kind': kind,
                'cosine': round(score, 4),
                'ambiguous': results[left].ambiguous or results[right].ambiguous,
            }
        )

    for index, left in enumerate(same_group):
        for right in same_group[index + 1:]:
            add_pair(left, right, 'same')
    for left in same_group:
        for right in args.negatives:
            add_pair(left, right, 'different')

    same_scores = [pair['cosine'] for pair in pairs if pair['kind'] == 'same']
    diff_scores = [pair['cosine'] for pair in pairs if pair['kind'] == 'different']

    def band(label: str, scores: list[float]) -> None:
        if not scores:
            print(f'{label}：没有可算的对')
            return
        ordered = sorted(scores)
        median = ordered[len(ordered) // 2]
        print(f'{label}（{len(scores)} 对）：min={ordered[0]:.4f}  中位={median:.4f}  max={ordered[-1]:.4f}')

    print('')
    band('同人组', same_scores)
    band('异人组', diff_scores)

    ok = bool(same_scores)
    if same_scores and diff_scores:
        margin = min(same_scores) - max(diff_scores)
        print(f'间隔：min(同人) − max(异人) = {margin:+.4f}（>0 才说明这把尺子在这组图上分得开）')
        false_accept = [pair for pair in pairs if pair['kind'] == 'different' and pair['cosine'] >= args.threshold]
        false_reject = [pair for pair in pairs if pair['kind'] == 'same' and pair['cosine'] < args.threshold]
        print(
            f'阈值 {args.threshold:.2f} 下的混淆：同人 {len(same_scores) - len(false_reject)}/{len(same_scores)} 判同；'
            f'异人 {len(diff_scores) - len(false_accept)}/{len(diff_scores)} 判异'
        )
        for pair in false_accept:
            print(f'  ⚠ 误判为同人：{short(pair["a"])} ↔ {short(pair["b"])}  cos={pair["cosine"]:.4f}')
        for pair in false_reject:
            print(f'  ⚠ 误判为不同人：{short(pair["a"])} ↔ {short(pair["b"])}  cos={pair["cosine"]:.4f}')
        if false_accept or false_reject:
            print('  → 有误判就**不能**拿单个阈值当验收结论；这张表是"这次比对的分布"，不是可信的概率')
        ok = ok and not false_accept and not false_reject
    else:
        print('⚠ 没给 --negatives：这些数字**没有刻度**，只能横向自比（这次 vs 上次），不能单独下"是同一个人"的结论')

    if any(row['verdict'] in {'noFace', 'ambiguous'} for row in subject_rows):
        ok = False

    if args.json:
        payload = {
            'model': f'insightface/{args.model}',
            'metric': 'cosine of L2-normalised ArcFace embedding',
            'threshold': args.threshold,
            'thresholdSource': 'external working point, not calibrated by this project',
            'anchor': {
                'path': args.anchor,
                'faceCount': anchor.face_count,
                'detScore': round(anchor.det_score, 4),
                'bbox': anchor.bbox,
            },
            'subjects': subject_rows,
            'negatives': negative_rows,
            'pairs': pairs,
            'bands': {
                'same': None
                if not same_scores
                else {'min': round(min(same_scores), 4), 'max': round(max(same_scores), 4)},
                'different': None
                if not diff_scores
                else {'min': round(min(diff_scores), 4), 'max': round(max(diff_scores), 4)},
            },
            'calibrated': bool(diff_scores),
            'pass': ok,
        }
        with open(args.json, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        print(f'\n已写 {args.json}')

    print('')
    if not ok and diff_scores:
        print('结论：这次比对**不适合**用来断言"是不是同一张脸"（见上面的误判对）；同人/异人两条分布有重叠')
    elif not ok:
        print('结论：有 subject 不成立（见上面的 verdict）')
    elif diff_scores:
        print(f'结论：{len(same_scores)} 对同人全过阈值、{len(diff_scores)} 对异人全被排除'
              f'（间隔 {min(same_scores) - max(diff_scores):+.4f}）')
    else:
        print(f'结论：{len(same_scores)} 对同人全过阈值，但**没有对照图**（未标定）；'
              '只能当作与历史值比较的相对指标')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
