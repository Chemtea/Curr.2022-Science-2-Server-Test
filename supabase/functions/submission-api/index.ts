/** Test migration guard: never accept client-provided correctness or scores. */
declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void };
Deno.serve(async (req: Request) => {
  const headers = { 'Access-Control-Allow-Origin': 'https://chemtea.github.io', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({ success: false, upgradeRequired: true, code: 'CLIENT_SCORE_DISABLED', message: '새 수업 화면을 열고 답안 선택 번호로 제출해 주세요. 이 테스트 서버는 브라우저에서 계산한 점수를 받지 않습니다.' }), { status: 410, headers });
});
