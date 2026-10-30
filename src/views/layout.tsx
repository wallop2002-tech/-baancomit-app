import type { Child } from 'hono/jsx'
import type { Business } from '../db'

const css = `
:root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1b; --muted:#6b6b66; --line:#e2e1dc; --accent:#2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#21211f; --ink:#ecebe6; --muted:#a3a29c; --line:#363632; --accent:#60a5fa; } }
* { box-sizing: border-box; }
body { margin:0; font-family: 'Sarabun', system-ui, sans-serif; background:var(--bg); color:var(--ink); }
header { display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); background:var(--card); }
header nav a { margin-right:12px; color:var(--ink); text-decoration:none; }
header nav a:hover { color:var(--accent); }
main { padding:16px; max-width:1100px; margin:0 auto; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; }
.stat b { display:block; font-size:24px; }
.stat span { color:var(--muted); }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); font-size:14px; }
th { color:var(--muted); font-weight:600; }
.scroll { overflow-x:auto; }
form.inline { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px; align-items:end; }
label { display:flex; flex-direction:column; font-size:13px; color:var(--muted); gap:4px; }
input, select, button, textarea { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--ink); }
button { background:var(--accent); color:#fff; border:none; cursor:pointer; }
.flash { padding:8px 12px; border-radius:6px; background:#e5f4e4; color:#1d1d1b; margin-bottom:12px; }
.bar { height:10px; background:var(--accent); border-radius:3px; }
.muted { color:var(--muted); }
button.link { background:none; color:var(--accent); padding:0; }
.error { background:#fbebeb; }
`

export function Layout(props: { title: string; businesses: Business[]; selected: number | null; user: { name: string } | null; flash?: string; error?: string; children: Child }) {
  const q = props.selected ? `?b=${props.selected}` : ''
  return (
    <html lang="th">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · บ้านคอมไอที</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet" />
        <style>{css}</style>
      </head>
      <body>
        <header>
          <strong>ระบบรวมงานร้าน</strong>
          <nav>
            <a href={`/${q}`}>ภาพรวม</a>
            <a href={`/orders${q}`}>ออเดอร์ขาย</a>
            <a href={`/stock${q}`}>สต็อก</a>
            <a href={`/products${q}`}>รุ่นสินค้า</a>
            <a href={`/reconcile${q}`}>จับคู่ยอดเงิน</a>
            <a href={`/claims${q}`}>เคลม</a>
            <a href={`/installments${q}`}>ผ่อน</a>
            <a href={`/reports${q}`}>รายงาน</a>
            <a href={`/users${q}`}>ผู้ใช้</a>
          </nav>
          {props.user && <span class="muted" style="margin-left:auto">{props.user.name}</span>}
          <form method="get" style={props.user ? '' : 'margin-left:auto'}>
            <select name="b" onchange="this.form.submit()">
              <option value="">ทุกกิจการ</option>
              {props.businesses.map((b) => (
                <option value={String(b.id)} selected={props.selected === b.id}>
                  {b.parent_id ? '— ' : ''}
                  {b.name}
                </option>
              ))}
            </select>
          </form>
        </header>
        <main>
          {!props.user && <div class="flash">ยังไม่มีผู้ใช้ในระบบ ทุกคนเข้าได้ทุกหน้า เพิ่มเจ้าของที่หน้า <a href="/users">ผู้ใช้</a> แล้วเปิด Cloudflare Access</div>}
          {props.flash && <div class="flash">{props.flash}</div>}
          {props.error && <div class="flash error">{props.error}</div>}
          {props.children}
        </main>
      </body>
    </html>
  )
}
