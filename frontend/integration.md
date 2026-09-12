# 接入说明

静态展示：访问 ?taskid=demo，读取 data/demo.json 和 assets/demo/ 下三轮历史图片，无需后端。

真实创作：在接口设置中配置后端地址，默认同源。

- POST /api/runs：请求 {request:string}，返回 {run_id:string}。
- GET /api/runs/:id：返回 request、status、started_at、ended_at 和 events。
- GET /api/runs/:id/events：SSE 事件流，按 event_id 去重。
- POST /api/runs/:id/cancel：请求停止任务。

事件字段为 event_id、run_id、iteration、stage、status、payload、timestamp。阶段包括 scene_analysis、prompt_generated、image_generation、image_evaluation、prompt_revision 及终态 accepted / failed / cancelled / limit_reached。

后端负责 Gateway 认证和模型凭据。前端只展示业务事件与产物，不能包含密钥。跨域部署需后端支持 CORS；HTTPS 页面需连接 HTTPS 后端。
