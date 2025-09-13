const fs = require("fs");
const fetch = require("node-fetch");

const TASK_FILE = "./config/tasks.json";
const DEFAULT_API_URL = "https://nodelua.com/home_iot/api/push.php";
const TRIGGER_WINDOW_MINUTES = 10; // 10分钟触发窗口

// 获取北京时间
function getBeijingTime() {
  let now = new Date();
  // GitHub Action 服务器是 UTC，需要加 8 小时
  now.setHours(now.getUTCHours() + 8);
  return now;
}

function loadTasks() {
  if (!fs.existsSync(TASK_FILE)) return [];
  return JSON.parse(fs.readFileSync(TASK_FILE, "utf-8"));
}

// 判断任务是否在当前时间的10分钟内触发
function shouldTrigger(task, now) {
  // 创建当前时间的Date对象副本
  const currentTime = new Date(now);
  // 计算10分钟后的时间
  const tenMinutesLater = new Date(now);
  tenMinutesLater.setMinutes(tenMinutesLater.getMinutes() + TRIGGER_WINDOW_MINUTES);
  
  // 根据任务类型计算任务的触发时间
  let taskTime;
  
  if (task.type === "date") {
    // 日期类型：使用指定的日期和时间
    const [month, day] = task.date.split('-').map(Number);
    taskTime = new Date(currentTime.getFullYear(), month - 1, day);
  } else if (task.type === "weekly") {
    // 每周类型：计算下一个指定星期几的时间
    taskTime = new Date(currentTime);
    const daysToAdd = (task.day[0] - currentTime.getDay() + 7) % 7;
    taskTime.setDate(taskTime.getDate() + daysToAdd);
  } else if (task.type === "workday") {
    // 工作日类型：如果是周末则调整到下周一
    taskTime = new Date(currentTime);
    if (currentTime.getDay() === 0) { // 周日
      taskTime.setDate(taskTime.getDate() + 1);
    } else if (currentTime.getDay() === 6) { // 周六
      taskTime.setDate(taskTime.getDate() + 2);
    }
  }
  
  // 设置任务的具体时间
  const [hours, minutes] = task.time.split(':').map(Number);
  taskTime.setHours(hours, minutes, 0, 0);
  
  // 如果计算出的任务时间已经过去（比如今天的任务时间已过），根据类型调整
  if (taskTime < currentTime) {
    if (task.type === "weekly") {
      // 每周任务：移至下一周
      taskTime.setDate(taskTime.getDate() + 7);
    } else if (task.type === "workday") {
      // 工作日任务：移至下一个工作日
      taskTime.setDate(taskTime.getDate() + 1);
      // 如果是周五，则移至下周一
      if (taskTime.getDay() === 5) {
        taskTime.setDate(taskTime.getDate() + 3);
      } else if (taskTime.getDay() === 6) { // 周六
        taskTime.setDate(taskTime.getDate() + 2);
      }
    } else if (task.type === "date") {
      // 日期任务：今年已过，移至明年
      taskTime.setFullYear(taskTime.getFullYear() + 1);
    }
  }
  
  // 检查任务时间是否在当前时间到10分钟后的范围内
  return taskTime >= currentTime && taskTime <= tenMinutesLater;
}

async function sendRequest(task) {
  const url = task.url || DEFAULT_API_URL;
  try {
    console.log(`\n=== 执行任务: ${task.id} ===`);
    console.log("请求 URL:", url);
    console.log("请求参数:", JSON.stringify(task.payload));

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task.payload)
    });

    const text = await res.text();

    console.log(`状态码: ${res.status}`);
    console.log(`接口返回: ${text}`);
    console.log(`=== 任务 ${task.id} 完成 ===\n`);
  } catch (e) {
    console.error(`任务 ${task.id} 请求失败:`, e);
  }
}

async function main() {
  const tasks = loadTasks();
  const now = getBeijingTime();
  console.log("当前北京时间:", now.toISOString());
  console.log(`检测未来${TRIGGER_WINDOW_MINUTES}分钟内的任务...`);

  if (tasks.length === 0) {
    console.log("⚠️ 没有任务可执行 (tasks.json 为空)");
    return;
  }

  let triggered = false;
  for (const task of tasks) {
    console.log(`检查任务: ${task.id}, 设定时间=${task.time}, 类型=${task.type}`);
    if (shouldTrigger(task, now)) {
      console.log(`✅ 任务 ${task.id} 将在10分钟内触发，立即执行`);
      triggered = true;
      await sendRequest(task);

      if (task.repeat === 0) {
        console.log("删除单次任务:", task.id);
        const updatedTasks = tasks.filter(t => t.id !== task.id);
        fs.writeFileSync(TASK_FILE, JSON.stringify(updatedTasks, null, 2));
      }
    }
  }

  if (!triggered) {
    console.log(`⏳ 未来${TRIGGER_WINDOW_MINUTES}分钟内没有匹配到任务`);
  }
}

main();
