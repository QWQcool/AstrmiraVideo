import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// 渲染并发：低核机器下调低（shotcraft README 的实测坑）
Config.setConcurrency(2);
