/**
 * 服务标识与版本的**唯一来源**（V2.17 / 台账 B52 片 A）。
 *
 * 为什么收成一处：它原先在 `health.ts`、`observability.ts`、`index.ts` 各写了一份
 * （"0.1.0" / "AstrmiraVideo Backend"）。版本号这种"三处都以为自己是对的"的常量，
 * 一旦发版时漏改一处，运维就会在 `/api/health/live` 与 `/api/metrics` 里看到两个版本号 ——
 * 而版本号恰恰是排错时最先看的那一行。
 */
export const SERVICE_NAME = 'AstrmiraVideo Backend';
export const SERVICE_VERSION = '0.1.0';
