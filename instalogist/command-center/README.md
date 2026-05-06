# Instalogist Command Center (M0)

رابط **فقط خواندنی** برای `operational-state.json`.

```bash
cd instalogist/command-center
npm install
npm run dev
```

مرورگر: `http://localhost:5174/#/health`

به‌روز کردن JSON:

```bash
cd ../parser
node src/cli.mjs --root ../workspace --out ../command-center/public/operational-state.json --lite
```

سپس در UI دکمه **Refresh**.

متغیر اختیاری: `VITE_OPERATIONAL_STATE_URL`
