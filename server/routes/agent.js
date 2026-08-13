const express = require("express");
const router = express.Router();
const { runAgentTask } = require("../../agent/graph");
const { searchBatchHistory, getCurrentStatus, auditComplianceRules, searchDocCode } = require("../../agent/tools");
const { runQuery } = require("../db");

/**
 * 1. AI 대화 엔드포인트 (POST /api/agent/chat)
 * Body: { message: string, history: Array<{role: string, content: string}> }
 */
router.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: "메시지 내용이 필요합니다." });
    }

    const conversationHistory = history || [];
    conversationHistory.push({ role: "user", content: message });

    console.log(`🤖 [AI Agent Request] 질문: "${message}"`);

    const replyText = await runAgentTask(conversationHistory);

    res.json({
      success: true,
      reply: replyText,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ AI 에이전트 라우터 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 2. 원장 계보 직관적 시각화 조회 API (GET /api/agent/genealogy-tree/:batchId)
 */
router.get("/genealogy-tree/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;
    const historyStr = await searchBatchHistory(batchId);
    const statusStr = await getCurrentStatus(batchId);

    const history = JSON.parse(historyStr);
    const status = JSON.parse(statusStr);

    res.json({
      success: true,
      batchId,
      status,
      history
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 3. AI 에이전트 시스템 추천 질문 목록 API (GET /api/agent/suggestions)
 */
router.get("/suggestions", async (req, res) => {
  try {
    const suggestions = [
      "RAW-SUP02-D03 오염 원료의 상위 계보 및 하위 영향 완제품 이력을 정밀 추적해줘.",
      "FG-PACK01-D14 제품의 실시간 온체인 보관자(Custodian)와 검사 성적서를 알려줘.",
      "콜드체인 보관온도 및 국가 식품위생법 규정 준수성 감사를 실행해줘.",
      "이더리움 스마트 컨트랙트 AccessControl 권한 체계와 IPFS 수록 원리를 설명해줘."
    ];

    res.json({ success: true, suggestions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
