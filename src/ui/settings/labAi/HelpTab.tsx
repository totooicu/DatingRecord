// 说明 tab：这一页能干什么、四个按钮各是什么、成果什么时候才真改库。

export function HelpTab() {
  return (
    <div className="aichat-help">
      <p>
        能查数据、建人物、记事件、整理聊天记录。<b>每次写库前自动备份</b>，聊完不满意可以整轮回退。
        支持上传文件（文本读内容、图片走视觉），附件只随这一条消息发送，不进文件库。
      </p>
      <p className="muted small">
        我能调用 person / event / chat / collection / file / snapshot / io / system 八组工具。
        模型的别名、服务商、密钥和连通测试在「设置 → AI → 模型」里。
      </p>
      <p className="muted small">
        顶部四个按钮：<b>聊天</b>是和 AI 对话；<b>历史会话</b>是自动保存的对话记录，可载入继续；
        <b>成果</b>是 AI / CLI 做过的改动记录，能看到具体建了谁、删了谁、记了什么事。AI 写完先暂存、不动你的库：点进去核对后，<b>执行</b>才让改动真正进库，<b>放弃</b>则当什么都没发生；已执行的成果也能<b>放弃改动</b>整轮回退到动手前。一份成果处理完才能继续下一轮对话。<b>说明</b>是本页。切换不中断 AI 正在做的事。
      </p>
    </div>
  );
}
