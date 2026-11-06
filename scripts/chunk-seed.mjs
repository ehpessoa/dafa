import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
let s = readFileSync('supabase/migrations/20261106000003_seed_curriculum.sql', 'utf8');
s = s.replace(/^-- GERADO.*\n/, '').replace(/^begin;\n/, '').replace(/commit;\n$/, '');
s = s.replace(/ on conflict \(\w+\) do update set [^;]*;/g, ';').replace(/delete from public\.\w+;\s*/g, '');
const stmts = s.split(/;\n(?=insert into)/).map((x) => x.replace(/;\s*$/, '') + ';');
const groups = [], cur = { n: [], len: 0 };
let chunks = [[]], size = 0;
for (const st of stmts) { if (size > 28000) { chunks.push([]); size = 0; } chunks.at(-1).push(st); size += st.length; }
mkdirSync('.tmp/seed', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`.tmp/seed/part${i + 1}.sql`, c.join('\n') + '\n'));
console.log(chunks.map((c, i) => `part${i + 1}: ${c.length} stmts, ${c.join('\n').length} bytes, first: ${c[0].slice(0, 45)}`).join('\n'));
