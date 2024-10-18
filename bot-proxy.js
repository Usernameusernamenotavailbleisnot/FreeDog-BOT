const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");
const { DateTime } = require("luxon");
const crypto = require("crypto");
const winston = require("winston");
const { HttpsProxyAgent } = require("https-proxy-agent");

// Configure Winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.printf(({ timestamp, level, message }) => {
      const uppercaseLevel = level.toUpperCase().padEnd(5);
      return `${timestamp} | ${uppercaseLevel} | ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

class FreeDogs {
  constructor() {
    this.headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language":
        "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: "https://app.freedogs.bot",
      Referer: "https://app.freedogs.bot/",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.proxies = {};
    this.accountProxyMap = {};
  }

  loadProxies() {
    const proxyFile = path.join(__dirname, "proxy.txt");
    if (fs.existsSync(proxyFile)) {
      const proxyList = fs.readFileSync(proxyFile, "utf8").split("\n").filter(Boolean);
      proxyList.forEach((proxy, index) => {
        this.proxies[index] = proxy;
      });
      logger.info(`Loaded ${Object.keys(this.proxies).length} proxies`);
    } else {
      logger.warn("No .proxy.txt file found. Running without proxies.");
    }
  }

  getProxyForAccount(userId) {
    if (!this.accountProxyMap[userId]) {
      const proxyKeys = Object.keys(this.proxies);
      if (proxyKeys.length > 0) {
        const proxyIndex = Math.floor(Math.random() * proxyKeys.length);
        this.accountProxyMap[userId] = this.proxies[proxyKeys[proxyIndex]];
      }
    }
    return this.accountProxyMap[userId];
  }

  createAxiosInstance(token = null, userId = null) {
    const config = {
      headers: { ...this.headers },
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const proxy = userId ? this.getProxyForAccount(userId) : null;
    if (proxy) {
      config.httpsAgent = new HttpsProxyAgent(proxy);
      logger.info(`Using proxy for user ${userId}: ${proxy}`);
    } else if (userId) {
      logger.warn(`No proxy available for user ${userId}`);
    }

    return axios.create(config);
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Wait ${i} seconds to continue the loop`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    logger.info("");
  }

  async callAPI(initData, userId) {
    const url = `https://api.freedogs.bot/miniapps/api/user/telegram_auth?invitationCode=QCGA4QGx&initData=${initData}`;

    try {
      const axiosInstance = this.createAxiosInstance(null, userId);
      const response = await axiosInstance.post(url);
      if (response.status === 200 && response.data.code === 0) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.msg };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  isExpired(token) {
    const [header, payload, sign] = token.split(".");
    const decodedPayload = Buffer.from(payload, "base64").toString();

    try {
      const parsedPayload = JSON.parse(decodedPayload);
      const now = Math.floor(DateTime.now().toSeconds());

      if (parsedPayload.exp) {
        const expirationDate = DateTime.fromSeconds(
          parsedPayload.exp
        ).toLocal();
        logger.info(
          `Token expires on: ${expirationDate.toFormat("yyyy-MM-dd HH:mm:ss")}`
        );

        const isExpired = now > parsedPayload.exp;
        logger.info(
          `Has the token expired? ${
            isExpired
              ? "Yes, you need to replace the token"
              : "Not yet, you can continue using the token"
          }`
        );

        return isExpired;
      } else {
        logger.warn(`Perpetual token, expiration time cannot be read`);
        return false;
      }
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      return true;
    }
  }

  async getGameInfo(token, userId) {
    const url = "https://api.freedogs.bot/miniapps/api/user_game_level/GetGameInfo?";

    try {
      const axiosInstance = this.createAxiosInstance(token, userId);
      const response = await axiosInstance.get(url);
      if (response.status === 200 && response.data.code === 0) {
        const data = response.data.data;
        logger.info(`The current balance: ${data.currentAmount}`);
        logger.info(`Coin Pool: ${data.coinPoolLeft}/${data.coinPoolLimit}`);
        logger.info(
          `Number of clicks today: ${data.userToDayNowClick}/${data.userToDayMaxClick}`
        );
        return { success: true, data: data };
      } else {
        return { success: false, error: response.data.msg };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  md5(input) {
    return crypto.createHash("md5").update(input).digest("hex");
  }

  async collectCoin(token, gameInfo, userId) {
    const url = "https://api.freedogs.bot/miniapps/api/user_game/collectCoin";

    let collectAmount = Math.min(
      gameInfo.coinPoolLeft,
      10000 - gameInfo.userToDayNowClick
    );
    const collectSeqNo = Number(gameInfo.collectSeqNo);
    const hashCode = this.md5(
      collectAmount + String(collectSeqNo) + "7be2a16a82054ee58398c5edb7ac4a5a"
    );

    const params = new URLSearchParams({
      collectAmount: collectAmount,
      hashCode: hashCode,
      collectSeqNo: collectSeqNo,
    });

    try {
      const axiosInstance = this.createAxiosInstance(token, userId);
      const response = await axiosInstance.post(url, params);
      if (response.status === 200 && response.data.code === 0) {
        logger.info(`Successfully collected ${collectAmount} coins`);
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.msg };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getTaskList(token, userId) {
    const url = "https://api.freedogs.bot/miniapps/api/task/lists?";

    try {
      const axiosInstance = this.createAxiosInstance(token, userId);
      const response = await axiosInstance.get(url);
      if (response.status === 200 && response.data.code === 0) {
        const tasks = response.data.data.lists.filter(
          (task) => task.isFinish === 0
        );
        return { success: true, data: tasks };
      } else {
        return { success: false, error: response.data.msg };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async completeTask(token, taskId, userId) {
    const url = `https://api.freedogs.bot/miniapps/api/task/finish_task?id=${taskId}`;

    try {
      const axiosInstance = this.createAxiosInstance(token, userId);
      const response = await axiosInstance.post(url);
      if (response.status === 200 && response.data.code === 0) {
        return { success: true };
      } else {
        return { success: false, error: response.data.msg };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async processTasks(token, userId) {
    const taskListResult = await this.getTaskList(token, userId);
    if (taskListResult.success) {
      for (const task of taskListResult.data) {
        logger.info(`Performing task: ${task.name}`);
        const completeResult = await this.completeTask(token, task.id, userId);
        if (completeResult.success) {
          logger.info(
            `Completed task ${task.name} successfully | Reward: ${task.rewardParty}`
          );
        } else {
          logger.error(
            `Cannot complete task ${task.name}: ${completeResult.error}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      logger.error(
        `Unable to get task list for account ${userId}: ${taskListResult.error}`
      );
    }
  }

  async main() {
    this.loadProxies();
    const dataFile = path.join(__dirname, "data.txt");
    const tokenFile = path.join(__dirname, "token.json");
    let tokens = {};

    if (fs.existsSync(tokenFile)) {
      tokens = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    }

    const data = fs
      .readFileSync(dataFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .filter(Boolean);
    while (true) {
      for (let i = 0; i < data.length; i++) {
        const rawInitData = data[i];
        const initData = rawInitData.replace(/&/g, "%26").replace(/=/g, "%3D");
        const userDataStr = decodeURIComponent(
          initData.split("user%3D")[1].split("%26")[0]
        );
        const userData = JSON.parse(decodeURIComponent(userDataStr));
        const userId = userData.id;
        const firstName = userData.first_name;

        logger.info(`Account ${i + 1} | ${firstName}`);

        let token = tokens[userId];
        let needNewToken = !token || this.isExpired(token);

        if (needNewToken) {
          logger.info(`Need to get new token for account ${userId}...`);
          const apiResult = await this.callAPI(initData, userId);

          if (apiResult.success) {
            logger.info(`Successfully obtained token for account ${userId}`);
            tokens[userId] = apiResult.data.token;
            token = apiResult.data.token;
            fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
            logger.info(`New token has been saved for account ${userId}`);
          } else {
            logger.error(
              `Failed to get token for account ${userId}: ${apiResult.error}`
            );
            continue;
          }
        }

        const gameInfoResult = await this.getGameInfo(token, userId);
        if (gameInfoResult.success) {
          if (gameInfoResult.data.coinPoolLeft > 0) {
            await this.collectCoin(token, gameInfoResult.data, userId);
          } else {
            logger.warn(`No coins to collect for account ${userId}`);
          }

          await this.processTasks(token, userId);
        } else {
          logger.error(
            `Unable to get game information for account ${userId}: ${gameInfoResult.error}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await this.countdown(60);
    }
  }
}

const client = new FreeDogs();
client.main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
