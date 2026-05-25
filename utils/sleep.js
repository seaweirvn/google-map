import { config } from "./config.js";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomInt = (min, max) => {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
};

// 防封基础策略：每次搜索、滚动、点击之间加入随机等待，降低固定节奏。
export const randomWait = async (min = config.minWaitMs, max = config.maxWaitMs) => {
  await sleep(randomInt(min, max));
};

export const longPause = async (ms = config.pauseMs) => {
  await sleep(ms);
};
