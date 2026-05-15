/**
 * WebSocket客户端测试脚本
 * 用于测试后端WebSocket服务的功能
 */

const WebSocket = require('ws');

// 创建两个测试客户端
const client1 = new WebSocket('ws://localhost:3000');
const client2 = new WebSocket('ws://localhost:3000');

let client1Code = null;
let client2Code = null;

// 客户端1事件处理
client1.on('open', () => {
  console.log('客户端1连接成功');
  
  // 发送设备信息
  client1.send(JSON.stringify({
    type: 'device_info',
    data: {}
  }));
});

client1.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('\n客户端1收到消息:', message);
  
  // 处理设备码生成
  if (message.type === 'device_code_generated') {
    client1Code = message.data.deviceCode;
    console.log('客户端1设备码:', client1Code);
    
    // 等待客户端2连接
    setTimeout(() => {
      // 发送配对请求给客户端2
      if (client2Code) {
        console.log('\n客户端1发送配对请求给:', client2Code);
        client1.send(JSON.stringify({
          type: 'pair_request',
          data: {
            targetCode: client2Code,
            nickname: '用户A'
          }
        }));
      }
    }, 2000);
  }
  
  // 处理配对响应
  if (message.type === 'pair_response') {
    if (message.data.success) {
      console.log('客户端1配对成功');
      
      // 发送测试消息
      setTimeout(() => {
        console.log('\n客户端1发送文本消息');
        client1.send(JSON.stringify({
          type: 'send_text_message',
          data: {
            content: '你好，这是来自客户端1的消息',
            to: client2Code
          }
        }));
      }, 1000);
      
      // 发送表情消息
      setTimeout(() => {
        console.log('\n客户端1发送表情消息');
        client1.send(JSON.stringify({
          type: 'send_emoji_message',
          data: {
            emojiId: '😀',
            to: client2Code
          }
        }));
      }, 2000);
    }
  }
  
  // 处理消息状态更新
  if (message.type === 'message_status_updated') {
    console.log('客户端1消息状态:', message.data.status);
  }
  
  // 处理收到的消息
  if (message.type === 'message_received') {
    console.log('客户端1收到消息:', message.data.content);
    
    // 发送已读确认
    client1.send(JSON.stringify({
      type: 'message_read',
      data: {
        messageId: message.data.id,
        to: client2Code
      }
    }));
  }
  
  // 处理配对请求
  if (message.type === 'pair_request_received') {
    console.log('客户端1收到配对请求来自:', message.data.from);
    
    // 接受配对请求
    client1.send(JSON.stringify({
      type: 'pair_accept',
      data: {
        to: message.data.from,
        nickname: '用户A'
      }
    }));
  }
});

client1.on('close', () => {
  console.log('客户端1连接关闭');
});

client1.on('error', (error) => {
  console.error('客户端1错误:', error);
});

// 客户端2事件处理
client2.on('open', () => {
  console.log('\n客户端2连接成功');
  
  // 发送设备信息
  client2.send(JSON.stringify({
    type: 'device_info',
    data: {}
  }));
});

client2.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('\n客户端2收到消息:', message);
  
  // 处理设备码生成
  if (message.type === 'device_code_generated') {
    client2Code = message.data.deviceCode;
    console.log('客户端2设备码:', client2Code);
  }
  
  // 处理配对请求
  if (message.type === 'pair_request_received') {
    console.log('客户端2收到配对请求来自:', message.data.from);
    
    // 接受配对请求
    client2.send(JSON.stringify({
      type: 'pair_accept',
      data: {
        to: message.data.from,
        nickname: '用户B'
      }
    }));
  }
  
  // 处理配对响应
  if (message.type === 'pair_response') {
    if (message.data.success) {
      console.log('客户端2配对成功');
      
      // 发送测试消息
      setTimeout(() => {
        console.log('\n客户端2发送文本消息');
        client2.send(JSON.stringify({
          type: 'send_text_message',
          data: {
            content: '你好，这是来自客户端2的回复',
            to: client1Code
          }
        }));
      }, 3000);
    }
  }
  
  // 处理收到的消息
  if (message.type === 'message_received') {
    console.log('客户端2收到消息:', message.data.content);
    
    // 发送已读确认
    client2.send(JSON.stringify({
      type: 'message_read',
      data: {
        messageId: message.data.id,
        to: client1Code
      }
    }));
  }
  
  // 处理消息状态更新
  if (message.type === 'message_status_updated') {
    console.log('客户端2消息状态:', message.data.status);
  }
});

client2.on('close', () => {
  console.log('客户端2连接关闭');
});

client2.on('error', (error) => {
  console.error('客户端2错误:', error);
});

// 测试结束后关闭连接
setTimeout(() => {
  console.log('\n测试结束，关闭连接');
  
  // 解除配对
  client1.send(JSON.stringify({
    type: 'unpair',
    data: {
      to: client2Code
    }
  }));
  
  setTimeout(() => {
    client1.close();
    client2.close();
  }, 1000);
}, 10000);