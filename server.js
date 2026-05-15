/**
 * 情侣聊天应用后端WebSocket服务
 * 处理设备配对、消息转发、状态同步等功能
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const uuidv4 = require("uuid/v4");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 中间件配置
app.use(cors());
app.use(express.json());

// 存储在线用户
const onlineUsers = new Map();
// 存储配对关系
const pairings = new Map();
// 存储设备码映射
const deviceCodeMap = new Map();

/**
 * 生成6位随机设备码
 */
function generateDeviceCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 查找用户的配对对象
 */
function findPartner(client) {
  if (!client.deviceCode) return null;
  const pairing = pairings.get(client.deviceCode);
  if (!pairing) return null;

  const partnerCode =
    pairing.user1 === client.deviceCode ? pairing.user2 : pairing.user1;
  const partner = deviceCodeMap.get(partnerCode);

  return partner ? onlineUsers.get(partner) : null;
}

/**
 * 发送消息给客户端
 */
function sendMessage(client, type, data) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(
      JSON.stringify({
        type: type,
        data: data,
        timestamp: Date.now(),
      }),
    );
  }
}

/**
 * 处理配对请求
 */
function handlePairRequest(client, data) {
  const { targetCode, nickname } = data;

  // 检查目标设备是否在线
  const targetClient = deviceCodeMap.get(targetCode);
  if (!targetClient || !onlineUsers.has(targetClient)) {
    sendMessage(client, "pair_response", {
      success: false,
      message: "目标设备不在线或不存在",
    });
    return;
  }

  // 检查是否已经配对
  if (pairings.has(client.deviceCode)) {
    sendMessage(client, "pair_response", {
      success: false,
      message: "您已经配对过了",
    });
    return;
  }

  if (pairings.has(targetCode)) {
    sendMessage(client, "pair_response", {
      success: false,
      message: "目标设备已经配对过了",
    });
    return;
  }

  // 发送配对请求给目标设备
  sendMessage(onlineUsers.get(targetClient), "pair_request_received", {
    from: client.deviceCode,
    nickname: nickname,
  });

  // 保存配对请求信息
  client.pairRequest = {
    targetCode: targetCode,
    nickname: nickname,
    timestamp: Date.now(),
  };

  // 回复发起方
  sendMessage(client, "pair_response", {
    success: true,
    message: "配对请求已发送，请等待对方确认",
  });
}

/**
 * 处理配对接受
 */
function handlePairAccept(client, data) {
  const { to, nickname } = data;

  const targetClient = deviceCodeMap.get(to);
  if (!targetClient || !onlineUsers.has(targetClient)) {
    sendMessage(client, "pair_response", {
      success: false,
      message: "请求方已离线",
    });
    return;
  }

  const target = onlineUsers.get(targetClient);

  // 创建配对关系
  const pairingId = uuidv4();
  const pairing = {
    id: pairingId,
    user1: client.deviceCode,
    user2: to,
    createdAt: Date.now(),
    user1Nickname: nickname,
    user2Nickname: target.pairRequest?.nickname || "用户",
  };

  // 存储配对关系
  pairings.set(client.deviceCode, pairing);
  pairings.set(to, pairing);

  // 通知双方配对成功
  sendMessage(client, "pair_response", {
    success: true,
    message: "配对成功",
    partnerInfo: {
      nickname: target.pairRequest?.nickname || "用户",
      deviceCode: to,
    },
  });

  sendMessage(target, "pair_response", {
    success: true,
    message: "配对成功",
    partnerInfo: {
      nickname: nickname,
      deviceCode: client.deviceCode,
    },
  });

  // 通知双方在线状态
  const partner1 = findPartner(client);
  const partner2 = findPartner(target);

  if (partner1) {
    sendMessage(partner1, "partner_status_updated", {
      isOnline: true,
      deviceCode: client.deviceCode,
    });
  }

  if (partner2) {
    sendMessage(partner2, "partner_status_updated", {
      isOnline: true,
      deviceCode: target.deviceCode,
    });
  }

  // 清除配对请求
  delete client.pairRequest;
  delete target.pairRequest;
}

/**
 * 处理配对拒绝
 */
function handlePairReject(client, data) {
  const { to } = data;

  const targetClient = deviceCodeMap.get(to);
  if (targetClient && onlineUsers.has(targetClient)) {
    sendMessage(onlineUsers.get(targetClient), "pair_response", {
      success: false,
      message: "对方拒绝了您的配对请求",
    });
  }

  sendMessage(client, "pair_response", {
    success: true,
    message: "已拒绝配对请求",
  });
}

/**
 * 处理解除配对
 */
function handleUnpair(client, data) {
  const { to } = data;

  // 清除配对关系
  pairings.delete(client.deviceCode);
  if (to) {
    pairings.delete(to);

    // 通知对方
    const targetClient = deviceCodeMap.get(to);
    if (targetClient && onlineUsers.has(targetClient)) {
      sendMessage(onlineUsers.get(targetClient), "unpair_notification", {
        message: "对方已解除配对",
        from: client.deviceCode,
      });
    }
  }

  sendMessage(client, "unpair_response", {
    success: true,
    message: "已解除配对",
  });
}

/**
 * 处理文本消息
 */
function handleTextMessage(client, data) {
  const { content, to } = data;

  // 检查是否配对
  if (!pairings.has(client.deviceCode)) {
    sendMessage(client, "message_status_updated", {
      messageId: uuidv4(),
      status: "failed",
      reason: "尚未配对，请先完成配对",
    });
    return;
  }

  // 检查目标是否正确
  const pairing = pairings.get(client.deviceCode);
  const targetCode =
    pairing.user1 === client.deviceCode ? pairing.user2 : pairing.user1;
  if (to && to !== targetCode) {
    sendMessage(client, "message_status_updated", {
      messageId: uuidv4(),
      status: "failed",
      reason: "只能发送消息给配对对象",
    });
    return;
  }

  // 查找配对对象
  const partner = findPartner(client);
  if (!partner) {
    sendMessage(client, "message_status_updated", {
      messageId: uuidv4(),
      status: "failed",
      reason: "对方不在线",
    });
    return;
  }

  // 生成消息ID
  const messageId = uuidv4();

  // 转发消息给配对对象
  sendMessage(partner, "message_received", {
    id: messageId,
    type: "text",
    content: content,
    from: client.deviceCode,
    timestamp: Date.now(),
  });

  // 回复发送方消息已送达
  sendMessage(client, "message_status_updated", {
    messageId: messageId,
    status: "sent",
  });
}

/**
 * 处理表情包消息
 */
function handleEmojiMessage(client, data) {
  const { emojiId, to } = data;

  // 检查是否配对
  if (!pairings.has(client.deviceCode)) {
    sendMessage(client, "message_status_updated", {
      messageId: uuidv4(),
      status: "failed",
      reason: "尚未配对，请先完成配对",
    });
    return;
  }

  // 检查目标是否正确
  const pairing = pairings.get(client.deviceCode);
  const targetCode =
    pairing.user1 === client.deviceCode ? pairing.user2 : pairing.user1;
  if (to && to !== targetCode) {
    sendMessage(client, "message_status_updated", {
      messageId: uuidv4(),
      status: "failed",
      reason: "只能发送消息给配对对象",
    });
    return;
  }

  // 查找配对对象
  const partner = findPartner(client);
  if (!partner) {
    sendMessage(client, "message_status_updated", {
      messageId: uuidv4(),
      status: "failed",
      reason: "对方不在线",
    });
    return;
  }

  // 生成消息ID
  const messageId = uuidv4();

  // 转发消息给配对对象
  sendMessage(partner, "message_received", {
    id: messageId,
    type: "emoji",
    content: emojiId,
    from: client.deviceCode,
    timestamp: Date.now(),
  });

  // 回复发送方消息已送达
  sendMessage(client, "message_status_updated", {
    messageId: messageId,
    status: "sent",
  });
}

/**
 * 处理消息已读确认
 */
function handleMessageRead(client, data) {
  const { messageId, to } = data;

  // 查找消息发送方
  const targetClient = deviceCodeMap.get(to);
  if (targetClient && onlineUsers.has(targetClient)) {
    sendMessage(onlineUsers.get(targetClient), "message_status_updated", {
      messageId: messageId,
      status: "read",
    });
  }
}

/**
 * 处理用户资料更新
 */
function handleProfileUpdate(client, data) {
  const { nickname, avatar, to } = data;

  // 通知配对对象
  const targetClient = deviceCodeMap.get(to);
  if (targetClient && onlineUsers.has(targetClient)) {
    sendMessage(onlineUsers.get(targetClient), "partner_profile_updated", {
      nickname: nickname,
      avatar: avatar,
      from: client.deviceCode,
    });
  }
}

/**
 * 处理设备信息
 */
function handleDeviceInfo(client, data) {
  const { deviceCode, isPaired, partnerCode } = data;

  // 如果客户端没有设备码，生成一个
  if (!deviceCode) {
    const newCode = generateDeviceCode();
    client.deviceCode = newCode;
    deviceCodeMap.set(newCode, client);

    sendMessage(client, "device_code_generated", {
      deviceCode: newCode,
    });
  } else {
    client.deviceCode = deviceCode;
    deviceCodeMap.set(deviceCode, client);
  }

  // 如果已配对，更新配对关系
  if (isPaired && partnerCode) {
    // 检查配对关系是否存在
    if (!pairings.has(deviceCode)) {
      // 创建一个简单的配对关系
      const pairing = {
        id: uuidv4(),
        user1: deviceCode,
        user2: partnerCode,
        createdAt: Date.now(),
      };
      pairings.set(deviceCode, pairing);
    }
  }

  // 发送连接状态
  sendMessage(client, "connection_status", {
    status: "connected",
    message: "WebSocket连接成功",
  });
}

/**
 * 处理心跳包
 */
function handlePing(client) {
  sendMessage(client, "pong", {});
}

/**
 * 消息路由处理
 */
function routeMessage(client, message) {
  try {
    const parsedMessage = JSON.parse(message);
    const { type, data } = parsedMessage;

    switch (type) {
      case "device_info":
        handleDeviceInfo(client, data);
        break;
      case "pair_request":
        handlePairRequest(client, data);
        break;
      case "pair_accept":
        handlePairAccept(client, data);
        break;
      case "pair_reject":
        handlePairReject(client, data);
        break;
      case "unpair":
        handleUnpair(client, data);
        break;
      case "send_text_message":
        handleTextMessage(client, data);
        break;
      case "send_emoji_message":
        handleEmojiMessage(client, data);
        break;
      case "message_read":
        handleMessageRead(client, data);
        break;
      case "update_profile":
        handleProfileUpdate(client, data);
        break;
      case "ping":
        handlePing(client);
        break;
      default:
        console.log("未知消息类型:", type);
        sendMessage(client, "error", {
          message: "未知消息类型",
        });
    }
  } catch (error) {
    console.error("消息解析错误:", error);
    sendMessage(client, "error", {
      message: "消息格式错误",
    });
  }
}

// WebSocket连接处理
wss.on("connection", (ws) => {
  console.log("新客户端连接");

  // 生成客户端ID
  ws.clientId = uuidv4();
  onlineUsers.set(ws, ws);

  // 监听消息
  ws.on("message", (message) => {
    routeMessage(ws, message);
  });

  // 监听关闭
  ws.on("close", () => {
    console.log("客户端断开连接");

    // 从在线用户移除
    onlineUsers.delete(ws);

    // 如果有设备码，也移除映射
    if (ws.deviceCode) {
      deviceCodeMap.delete(ws.deviceCode);

      // 通知配对对象
      const partner = findPartner(ws);
      if (partner) {
        sendMessage(partner, "partner_status_updated", {
          isOnline: false,
          deviceCode: ws.deviceCode,
        });
      }
    }

    // 清除未完成的配对请求
    if (ws.pairRequest) {
      const targetClient = deviceCodeMap.get(ws.pairRequest.targetCode);
      if (targetClient && onlineUsers.has(targetClient)) {
        sendMessage(onlineUsers.get(targetClient), "pair_request_canceled", {
          from: ws.deviceCode,
          reason: "请求方已离线",
        });
      }
    }
  });

  // 监听错误
  ws.on("error", (error) => {
    console.error("WebSocket错误:", error);
  });
});

// HTTP API接口
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "服务运行正常",
    onlineUsers: onlineUsers.size,
    pairings: pairings.size,
    timestamp: Date.now(),
  });
});

app.get("/api/stats", (req, res) => {
  res.json({
    onlineUsers: onlineUsers.size,
    totalPairings: pairings.size,
    deviceCodes: deviceCodeMap.size,
    serverTime: Date.now(),
  });
});

// 启动服务
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`WebSocket服务运行在 ws://localhost:${PORT}`);
});

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("收到SIGTERM信号，正在关闭服务器...");
  server.close(() => {
    console.log("服务器已关闭");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("收到SIGINT信号，正在关闭服务器...");
  server.close(() => {
    console.log("服务器已关闭");
    process.exit(0);
  });
});
