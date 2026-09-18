export type HomeQuote = {
  text: string;
  author: string;
};

const builtinQuotes: HomeQuote[] = [
  { text: "把复杂的事做简单，把简单的事做长久。", author: "今日短句" },
  { text: "慢一点没关系，只要方向没有丢。", author: "今日短句" },
  { text: "今天完成的一小步，会成为明天的起点。", author: "今日短句" },
  { text: "先让事情跑起来，再让它变漂亮。", author: "今日短句" },
  { text: "真正有用的系统，是你愿意每天打开的系统。", author: "今日短句" },
  { text: "给未来的自己留下清楚的路径。", author: "今日短句" },
  { text: "不追求一次完美，追求持续变好。", author: "今日短句" },
  { text: "少一点噪音，多一点真正重要的东西。", author: "今日短句" },
  { text: "把注意力留给值得长期积累的事。", author: "今日短句" },
  { text: "记录不是为了收藏过去，而是为了看清下一步。", author: "今日短句" },
  { text: "清晰本身，就是一种效率。", author: "今日短句" },
  { text: "能重复使用的经验，才会慢慢变成能力。", author: "今日短句" },
  { text: "先解决最影响体验的那一个问题。", author: "今日短句" },
  { text: "保持一点好奇，也保持一点耐心。", author: "今日短句" },
  { text: "把每天真正会用的东西，放在伸手可及的地方。", author: "今日短句" },
  { text: "好的工具应该减少记忆负担，而不是增加步骤。", author: "今日短句" },
  { text: "今天留下的结构，会替未来节省时间。", author: "今日短句" },
  { text: "持续整理，就是持续理解自己。", author: "今日短句" },
  { text: "每一次小优化，都在减少下一次的摩擦。", author: "今日短句" },
  { text: "想法先落地，答案会在使用中变清楚。", author: "今日短句" },
  { text: "不必把所有事做完，只要把重要的事往前推。", author: "今日短句" },
  { text: "留一点空白，才能看见新的可能。", author: "今日短句" },
  { text: "稳定地做正确的小事，比偶尔用力更可靠。", author: "今日短句" },
  { text: "一个舒服的入口，会让开始这件事变容易。", author: "今日短句" },
  { text: "整理信息，也是整理自己的判断。", author: "今日短句" },
  { text: "别让工具成为目标，让它服务真正想做的事。", author: "今日短句" },
  { text: "先建立节奏，再追求速度。", author: "今日短句" },
  { text: "把重复的选择交给系统，把注意力留给创造。", author: "今日短句" },
  { text: "每次回来，都应该比上次更容易找到方向。", author: "今日短句" },
  { text: "认真生活，也认真保存那些值得回看的瞬间。", author: "今日短句" }
];

export function randomHomeQuote(customText?: string, customAuthor?: string): HomeQuote {
  const pool = customText?.trim()
    ? [{ text: customText.trim(), author: customAuthor?.trim() || "今日短句" }, ...builtinQuotes]
    : builtinQuotes;

  return pool[Math.floor(Math.random() * pool.length)] ?? builtinQuotes[0];
}

export function getBuiltinQuotes() {
  return [...builtinQuotes];
}
