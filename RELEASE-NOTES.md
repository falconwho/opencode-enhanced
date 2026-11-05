# OpenCode Enhanced Release Notes

## opencode Enhanced v1.18.35-enhanced.1.15.4

A Windows portable build based on the opencode v1.18.35 core. This release consolidates the complete 1.10 through 1.15.4 feature line into one public build.

### Memory v3

- Local SQLite long-term memory with independent user, project, and shared databases.
- Memory palace rooms and slots, append-only tour routes, and shared-scope packet injection.
- Hybrid retrieval: FTS5 with Chinese 2-gram tokenization plus local embeddings; automatically falls back to keyword search when the embedding model is unavailable.
- Nine model-facing memory tools: save, search, read, facts, assess, timeline, mutate, navigate, and distill.
- Long-workflow checkpoints at idle, during long tool loops, and on a time interval, with pending-ingest replay after failures or timeouts.
- Reflection suggestions (`merge`, `supersede`, `observe`, `link`) with accept/reject UI; auto mode only applies safe link and observe suggestions.
- Independent distillation into higher-level facts and skills, with supersede chains and audit history.
- Multi-query search rewriting with RRF fusion and per-query reserves; failures fall back to the original query.
- Backup/restore across user, shared, and all project databases; JSON and Markdown export; embedding rebuild; clear creates a backup first.
- Memory dialog with overview, library, profile, records, and operations; inline editing and a dedicated back-to-settings action.
- After context compaction, a fresh full memory packet is rebuilt at the head of the model context. Later changes update that packet in place, and old scattered memory deltas are filtered out.
- Removed the separate SM-2 review workflow and memory search box; memory search remains available to the model.

### Prompt Cache And Stability

- Halogen side requests (title, approval, memory, compaction) are marked `no_store`, so they do not write to or evict the main conversation's prompt cache.
- Root Halogen sessions keep stable `X-Halogen-Keep` / `X-Halogen-From` resume points across turns.
- The current date is no longer embedded in the stable system prompt; it is persisted as a synthetic date part only when the date changes.
- Plan/Build reminders are persisted and idempotent, so existing user history is not rewritten.
- AGENTS.md reminders are inserted at adaptive intervals, kept out of the visible chat stream, and avoid the compaction threshold.

### Sessions And Workflow

- New sessions start from build; existing sessions restore their own agent, model, and thinking level.
- Explicit default thinking levels are preserved and are not overwritten by a global fallback.
- Forked sessions inherit the agent/model/variant of the message being forked.
- If a session has no local model selection, the agent falls back to the session state and then the last user message before build.
- Continuous `@` mentions for multiple files, conversations, and agents in one prompt.
- Enter-to-rename for session group folders; Esc cancels and blur saves.
- Normal session entry and the message navigator start at the bottom, while message deep links keep their target.

### UI And Interaction

- Unified compact 3px scrollbars across the sidebar, message navigator, reasoning preview, and main conversation.
- User messages show a local date next to the existing time.
- Tool and file-operation rows use a tighter 24px rhythm.
- Permission, question, success, and error toasts now appear at the top-right of the conversation instead of covering the input box.
- Settings footer shows the OpenCode version and Enhanced release version on two lines.
- Reasoning preview follows streaming output and pauses when the user scrolls up.
- Image attachments are reused by ID while typing, avoiding repeated image re-decoding and preview rebuilds.
- Fixed duplicate titlebar search/status actions and incorrect auto-scroll behavior.

### Memory And UI Fixes

- Fixed memory dialog crashes caused by missing SDK context and malformed HTTP responses.
- Memory v3 responses are JSON-safe, and node/search limits are parsed correctly.
- The memory dialog shows an in-window error bar with retry instead of crashing the renderer.
- Fixed memory backup/restore metadata and shared-memory reflection handling.
- Fixed compaction rendering after synthetic messages, and the to-do list lifecycle across turns.
- Error page no longer includes upstream update/report actions; restart and log export remain.

### Download

- `opencode-enhanced-win-x64-portable.zip` — portable; unzip and run `opencode Enhanced.exe`
- Size: 334,345,736 bytes
- SHA256: `CB1B437F96B20FCA2C8C00B589605F043529080DB595D26595C1DF80191762CC`

### Notes

- Config/data/log paths are fully isolated and do not affect an existing opencode installation.
- Fully exit any running "opencode Enhanced" process before switching builds.
- Windows x64, portable only.

---

# opencode 增强版发布记录

## opencode 增强版 v1.18.35-enhanced.1.15.4

基于 opencode v1.18.35 内核的 Windows 免安装版本。本版本将 1.10 到 1.15.4 的完整功能线整合为一个公开构建。

### Memory v3

- 本地 SQLite 长期记忆，用户、项目、共享三套独立数据库。
- 记忆宫殿房间与桩位、只增路线、共享作用域记忆包注入。
- 混合检索：FTS5 中文 2-gram + 本地向量；模型不可用时自动降级关键词检索。
- 9 个面向模型的记忆工具：save、search、read、facts、assess、timeline、mutate、navigate、distill。
- 空闲、长时间工具循环和时间间隔触发记忆摄取；失败或超时通过 pending journal 重放。
- 反思建议 `merge` / `supersede` / `observe` / `link`，支持接受和拒绝；自动模式只应用安全的 link 和 observe。
- 独立蒸馏：从活跃记忆提炼更高层的 fact/skill，建立取代链并写审计历史。
- 多查询改写：原查询保留，最多改写 3 个互补查询，RRF 融合并保留每查询保底命中；失败自动退回单查询。
- 备份恢复覆盖用户、共享和所有项目数据库；支持 JSON/Markdown 导出、embedding 重建；清空前自动备份。
- 记忆窗口包含概览、记忆库、画像、记录和运维；支持内联编辑和返回设置。
- 上下文压缩后，在模型上下文头部重建完整记忆包；后续记忆变化原位更新，旧的散落 memory delta 不再进入上下文。
- 移除独立的 SM-2 复习流程和记忆库界面搜索框；AI 仍可使用记忆搜索工具。

### Prompt 缓存与稳定性

- 标题、审批、记忆和压缩等 Halogen 辅助请求标记为 `no_store`，不再写入或挤占主对话 prompt 缓存。
- 根 Halogen 会话跨轮保持稳定的 `X-Halogen-Keep` / `X-Halogen-From` 恢复点。
- 当前日期不再写入稳定 system prompt，只在日期变化时作为 synthetic date part 持久化。
- Plan/Build 提醒持久化且幂等，不再改写已有用户历史。
- AGENTS.md 提醒按自适应间隔插入，不进入可见聊天流，并避开压缩阈值。

### 会话与工作流

- 新会话默认从 build 开始；已有会话恢复自己的 agent、模型和思考强度。
- 显式选择的默认思考强度会保留，不被全局回退覆盖。
- Fork 会话继承被 fork 消息的 agent/model/variant。
- 本地没有模型选择时，agent 按会话状态、最后一条用户消息、build 的顺序回退。
- 同一个输入框可以连续 @ 多个文件、会话和智能体。
- 分组文件夹按回车立即重命名；Esc 取消，失焦保存。
- 普通进入会话和“我的消息”导航自动停在底部；带消息目标的深链接保持原位。

### 界面与交互

- 左侧会话栏、“我的消息”、推理预览和主对话统一为紧凑的 3px 滚动条。
- 用户消息在原有时间旁显示本地日期。
- 工具和文件操作行使用更紧凑的 24px 节奏。
- 权限、问答、成功和错误提示改为出现在主对话区右上角，不再遮挡输入框。
- 设置页底部两行显示 OpenCode 版本和增强版版本。
- 推理预览随流式输出跟随，用户上滚时暂停。
- 插入图片后继续输入文字时按 ID 复用附件对象，避免重复解码和预览重建。
- 修复重复标题栏搜索/状态按钮和错误的自动滚动行为。

### 记忆与界面修复

- 修复记忆窗口因缺少 SDK context 和非法 HTTP 响应导致的崩溃。
- Memory v3 响应统一 JSON-safe；节点和搜索 limit 正确解析。
- 记忆窗口加载失败改为窗口内错误条和重试，不再让整个 renderer 崩溃。
- 修复记忆备份恢复 metadata 和共享记忆反思处理。
- 修复 synthetic 消息导致的压缩后渲染问题和 to-do 列表生命周期问题。
- 错误页移除上游更新/上报入口，保留重启和导出日志。

### 下载

- `opencode-enhanced-win-x64-portable.zip` — 免安装版，解压后直接运行 `opencode Enhanced.exe`
- 大小：334,345,736 字节
- SHA256：`CB1B437F96B20FCA2C8C00B589605F043529080DB595D26595C1DF80191762CC`

### 说明

- 配置/数据/日志路径完全隔离，不影响现有 opencode 安装。
- 切换版本前请完全退出正在运行的 "opencode Enhanced" 进程。
- 仅 Windows x64，便携版。
