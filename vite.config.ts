import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { handleGeminiRequest, type GeminiRequestBody } from './server/geminiCore.js'

/**
 * STEP 12-1 — `npm run dev`에서도 프로덕션(Vercel Serverless Function)과 동일한
 * /api/gemini 엔드포인트를 쓸 수 있도록 하는 개발용 미들웨어. 실제 relay 로직은
 * server/geminiCore.ts 하나만 존재하며(중복 없음), 이 플러그인과 api/gemini.ts는
 * 둘 다 그 함수를 얇게 감싸기만 한다.
 */
function geminiDevApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'gemini-dev-api',
    configureServer(server) {
      if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
      server.middlewares.use('/api/gemini', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        let raw = ''
        req.on('data', (chunk) => {
          raw += chunk
        })
        req.on('end', () => {
          void (async () => {
            try {
              const body = (raw ? JSON.parse(raw) : {}) as GeminiRequestBody
              const result = await handleGeminiRequest(body)
              res.statusCode = result.status
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify(result.body))
            } catch {
              res.statusCode = 400
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ error: '요청 형식이 올바르지 않습니다.' }))
            }
          })()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), geminiDevApiPlugin(env)],
  }
})
