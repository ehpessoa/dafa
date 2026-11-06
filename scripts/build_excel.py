"""Gera o dataset em Excel e os templates .xlsx a partir dos CSVs exportados (.tmp/csv)."""
import csv, os
from datetime import date
from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

CSV = '.tmp/csv'
HEAD = PatternFill('solid', fgColor='1E3A8A')
HF = Font(bold=True, color='FFFFFF')
NOTE = Font(italic=True, color='555555')
os.makedirs('web/public/data', exist_ok=True)
os.makedirs('web/public/templates', exist_ok=True)

def rows(name):
    with open(f'{CSV}/{name}.csv', encoding='utf-8') as f:
        r = list(csv.reader(f))
    return r[0], r[1:]

def conv(h, v):
    if v == '': return None
    if h.endswith('_id') or h in ('quantidade', 'prazo_dias', 'impressoes', 'cliques', 'conversoes', 'publico', 'temporada', 'rodada') or h.startswith('gols'):
        return int(v)
    if h in ('frete', 'desconto_pct', 'preco', 'custo', 'preco_unitario', 'investimento', 'valor', 'receita_bilheteria'):
        return float(v)
    if h.startswith('data') or h == 'mes':
        return date.fromisoformat(v)
    return v

def style_header(ws, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(1, c); cell.fill = HEAD; cell.font = HF; cell.alignment = Alignment(horizontal='center')
        ws.column_dimensions[get_column_letter(c)].width = 18
    ws.freeze_panes = 'A2'

# ── 1) Dataset completo ──
wb = Workbook(); wb.remove(wb.active)
ws = wb.create_sheet('LEIAME')
for i, line in enumerate([
    'Dataset de treinamento DAFA – dados 100% fictícios (2024-01 a 2025-12).',
    'Mesmo conteúdo do schema "treinamento" no Supabase. Cada aba = uma tabela.',
    'dim_* = dimensões (cadastros). fato_* = eventos/transações. esporte_partidas = cenário esportivo.',
    'Chaves: fato_pedidos.cliente_id -> dim_clientes | fato_itens_pedido.pedido_id/produto_id | fato_entregas.pedido_id.',
    'Receita de um item = quantidade * preco_unitario (preço já com desconto). Margem = receita - quantidade*custo.',
], 1):
    ws.cell(i, 1, line); 
ws['A1'].font = Font(bold=True, size=14); ws.column_dimensions['A'].width = 120
for t in ['dim_clientes','dim_produtos','fato_pedidos','fato_itens_pedido','fato_entregas','fato_campanhas','fato_financeiro','esporte_partidas']:
    h, data = rows(t); w = wb.create_sheet(t); w.append(h)
    for r in data: w.append([conv(c, v) for c, v in zip(h, r)])
    style_header(w, len(h))
    for col, c in enumerate(h, 1):
        if c.startswith('data') or c == 'mes':
            for cell in w[get_column_letter(col)][1:]: cell.number_format = 'DD/MM/YYYY'
wb.save('web/public/data/dataset_treinamento.xlsx')

# ── 2) Painel de vendas (template) ──
h_ped, ped = rows('fato_pedidos'); h_it, it = rows('fato_itens_pedido'); h_pr, pr = rows('dim_produtos')
cat = {r[0]: r[2] for r in pr}
pedmap = {r[0]: r for r in ped}
dados = []
for r in it:
    p = pedmap[r[1]]
    if p[2] >= '2025-01-01':
        dados.append([int(r[1]), date.fromisoformat(p[2]), p[4], p[3], p[5], cat[r[2]], int(r[3]), float(r[4])])
    if len(dados) >= 600: break

wb = Workbook(); ws = wb.active; ws.title = 'LEIAME'
for i, t in enumerate(['Painel de Vendas – template (Semana 1)',
    '1) Aba Dados: amostra de 600 itens de 2025. Substitua pelo dataset completo (cole as abas do dataset e crie as colunas).',
    '2) Aba Calculos: fórmulas SOMASES/CONT.SES/MÉDIASES prontas – complete os TODO.',
    '3) Aba Painel: KPIs e gráficos. Use título-conclusão e o checklist de qualidade.',
    '4) Crie sua Tabela Dinâmica em uma nova aba chamada Dinamica.'], 1):
    ws.cell(i, 1, t)
ws['A1'].font = Font(bold=True, size=14); ws.column_dimensions['A'].width = 110

wd = wb.create_sheet('Dados')
wd.append(['pedido_id','data_pedido','canal','status','uf_entrega','categoria','quantidade','preco_unitario','receita'])
for i, r in enumerate(dados, 2):
    wd.append(r + [f'=G{i}*H{i}'])
    wd.cell(i, 2).number_format = 'DD/MM/YYYY'; wd.cell(i, 8).number_format = 'R$ #,##0.00'; wd.cell(i, 9).number_format = 'R$ #,##0.00'
style_header(wd, 9)
n = len(dados) + 1

wc = wb.create_sheet('Calculos')
wc['A1'] = 'Receita por canal (exclui cancelados)'; wc['A1'].font = Font(bold=True)
wc.append(['canal', 'receita', 'itens', 'ticket por item'])
for i, c in enumerate(['site', 'app', 'marketplace', 'loja'], 3):
    wc.cell(i, 1, c)
    wc.cell(i, 2, f'=SUMIFS(Dados!$I$2:$I${n},Dados!$C$2:$C${n},A{i},Dados!$D$2:$D${n},"<>cancelado")').number_format = 'R$ #,##0'
    wc.cell(i, 3, f'=COUNTIFS(Dados!$C$2:$C${n},A{i},Dados!$D$2:$D${n},"<>cancelado")')
    wc.cell(i, 4, f'=IFERROR(B{i}/C{i},0)').number_format = 'R$ #,##0.00'
wc['A9'] = 'Receita por categoria'; wc['A9'].font = Font(bold=True)
wc.append([]); wc['A10'] = 'categoria'; wc['B10'] = 'receita'; wc['C10'] = '% do total'
cats = ['Eletrônicos','Casa','Moda','Esporte','Beleza','Livros']
for i, c in enumerate(cats, 11):
    wc.cell(i, 1, c); wc.cell(i, 2, f'=SUMIFS(Dados!$I$2:$I${n},Dados!$F$2:$F${n},A{i})').number_format = 'R$ #,##0'
    wc.cell(i, 3, f'=B{i}/SUM($B$11:$B$16)').number_format = '0.0%'
wc['A19'] = 'TODO: crie aqui 3 fórmulas com PROCX (ex.: nome do produto a partir de dim_produtos) e 1 com SE aninhado (meta atingida?).'; wc['A19'].font = NOTE
for c in 'ABCD': wc.column_dimensions[c].width = 22
for r in (2, 10): 
    for c in range(1, 5): wc.cell(r, c).font = Font(bold=True)

wp = wb.create_sheet('Painel')
wp['A1'] = 'PAINEL DE VENDAS 2025 – escreva aqui a conclusão principal'; wp['A1'].font = Font(bold=True, size=16)
for i, (label, f, fmt) in enumerate([('Receita total', f'=SUM(Dados!I2:I{n})', 'R$ #,##0'), ('Itens vendidos', f'=SUM(Dados!G2:G{n})', '#,##0'),
        ('Ticket por item', '=IFERROR(B3/B4,0)', 'R$ #,##0.00')], 3):
    wp.cell(i, 1, label).font = Font(bold=True); c = wp.cell(i, 2, f); c.number_format = fmt
ch = BarChart(); ch.title = 'Receita por canal'; ch.add_data(Reference(wc, min_col=2, min_row=2, max_row=6), titles_from_data=True)
ch.set_categories(Reference(wc, min_col=1, min_row=3, max_row=6)); ch.height, ch.width = 7, 12; wp.add_chart(ch, 'A8')
ch2 = BarChart(); ch2.type = 'bar'; ch2.title = 'Receita por categoria'; ch2.add_data(Reference(wc, min_col=2, min_row=10, max_row=16), titles_from_data=True)
ch2.set_categories(Reference(wc, min_col=1, min_row=11, max_row=16)); ch2.height, ch2.width = 7, 12; wp.add_chart(ch2, 'H8')
wp.column_dimensions['A'].width = 24; wp.column_dimensions['B'].width = 18
wb.save('web/public/templates/painel-vendas.xlsx')

# ── 3) Catálogo de KPIs ──
wb = Workbook(); wb.remove(wb.active)
kp = {
 'Comercial': [('Receita', 'Soma de quantidade x preço', 'fato_itens_pedido', 'Mensal'), ('Ticket médio', 'Receita / Pedidos', 'fato_pedidos + itens', 'Mensal'), ('Margem %', '(Receita - Custo) / Receita', 'itens + dim_produtos', 'Mensal')],
 'Financeiro': [('Resultado', 'Receitas - Despesas', 'fato_financeiro', 'Mensal'), ('Caixa acumulado', 'Soma acumulada do resultado', 'fato_financeiro', 'Mensal'), ('Desvio orçado x realizado', '(Realizado - Orçado) / Orçado', 'orçamento + financeiro', 'Mensal')],
 'Logística': [('% entregas no prazo', 'Entregas <= prazo / Entregas', 'fato_entregas', 'Semanal'), ('Atraso médio (dias)', 'Média(entrega - envio - prazo) onde > 0', 'fato_entregas', 'Semanal'), ('Frete médio', 'Média do frete por pedido', 'fato_pedidos', 'Mensal')],
 'E-commerce': [('Conversão', 'Pedidos / Cliques', 'campanhas + pedidos', 'Semanal'), ('Taxa de cancelamento', 'Cancelados / Pedidos', 'fato_pedidos', 'Semanal'), ('Recompra 90d', 'Clientes com 2ª compra em 90d / Clientes', 'fato_pedidos', 'Mensal')],
 'Marketing': [('CTR', 'Cliques / Impressões', 'fato_campanhas', 'Semanal'), ('CPA', 'Investimento / Conversões', 'fato_campanhas', 'Semanal'), ('ROAS', 'Receita atribuída / Investimento', 'campanhas + pedidos', 'Mensal')],
 'Esporte': [('Público médio', 'Média do público por jogo', 'esporte_partidas', 'Por rodada'), ('Receita por torcedor', 'Bilheteria / Público', 'esporte_partidas', 'Por rodada'), ('Aproveitamento', 'Pontos / (3 x jogos)', 'esporte_partidas', 'Por rodada')],
}
for area, items in kp.items():
    w = wb.create_sheet(area); w.append(['KPI', 'Definição / fórmula', 'Fonte (tabela)', 'Frequência', 'Meta', 'Dono', 'Consulta SQL / medida DAX'])
    for it_ in items: w.append(list(it_) + ['', '', ''])
    for _ in range(4): w.append([''] * 7)
    style_header(w, 7); w.column_dimensions['B'].width = 42; w.column_dimensions['G'].width = 50
wb.save('web/public/templates/kpis-areas.xlsx')

# ── 4) DRE e fluxo de caixa ──
h_f, fin = rows('fato_financeiro')
months = sorted({r[1][:7] for r in fin if r[1].startswith('2025')})
wb = Workbook(); ws = wb.active; ws.title = 'DRE_Mensal'
ws.append(['Linha'] + [f'{m[5:]}/{m[:4]}' for m in months] + ['Total 2025'])
lines = [('Vendas de produtos', 'receita'), ('Serviços e assinaturas', 'receita'), ('Custo de mercadorias', 'despesa'), ('Marketing e mídia', 'despesa'),
         ('Logística e fretes', 'despesa'), ('Pessoal', 'despesa'), ('Tecnologia', 'despesa'), ('Aluguel e utilidades', 'despesa')]
val = {(r[3], r[1][:7]): float(r[5]) for r in fin}
for i, (nome, tipo) in enumerate(lines, 2):
    ws.cell(i, 1, nome)
    for j, m in enumerate(months, 2): ws.cell(i, j, round(val.get((nome, m), 0), 2)).number_format = '#,##0'
    ws.cell(i, len(months) + 2, f'=SUM(B{i}:{get_column_letter(len(months)+1)}{i})').number_format = '#,##0'
r0 = len(lines) + 2
for k, (label, f) in enumerate([('Receita total', '=SUM({c}2:{c}3)'), ('Despesa total', '=SUM({c}4:{c}9)'), ('Resultado', '={c}{a}-{c}{b}'), ('Margem %', '=IFERROR({c}{r}/{c}{a},0)')]):
    row = r0 + k; ws.cell(row, 1, label).font = Font(bold=True)
    for j in range(2, len(months) + 3):
        c = get_column_letter(j)
        cell = ws.cell(row, j, f.format(c=c, a=r0, b=r0 + 1, r=r0 + 2)); cell.number_format = '0.0%' if label == 'Margem %' else '#,##0'
style_header(ws, len(months) + 2); ws.column_dimensions['A'].width = 28
wf = wb.create_sheet('Fluxo_Caixa'); wf.append(['Mês', 'Resultado', 'Caixa acumulado'])
for j, m in enumerate(months, 2):
    wf.cell(j, 1, f'{m[5:]}/{m[:4]}'); wf.cell(j, 2, f'=DRE_Mensal!{get_column_letter(j)}{r0+2}').number_format = '#,##0'
    wf.cell(j, 3, f'=SUM($B$2:B{j})').number_format = '#,##0'
style_header(wf, 3)
lc = LineChart(); lc.title = 'Caixa acumulado 2025'; lc.add_data(Reference(wf, min_col=3, min_row=1, max_row=len(months) + 1), titles_from_data=True)
lc.set_categories(Reference(wf, min_col=1, min_row=2, max_row=len(months) + 1)); wf.add_chart(lc, 'E2')
wo = wb.create_sheet('Orcado_vs_Realizado'); wo.append(['Centro de custo', 'Orçado', 'Realizado', 'Desvio R$', 'Desvio %', 'Status'])
real = {}
for r in fin:
    if r[1].startswith('2025') and r[2] == 'despesa': real[r[4]] = real.get(r[4], 0) + float(r[5])
for i, (cc, v) in enumerate(sorted(real.items()), 2):
    wo.cell(i, 1, cc); wo.cell(i, 2, round(v * 0.95, 0)).number_format = '#,##0'; wo.cell(i, 3, round(v, 0)).number_format = '#,##0'
    wo.cell(i, 4, f'=C{i}-B{i}').number_format = '#,##0'; wo.cell(i, 5, f'=IFERROR(D{i}/B{i},0)').number_format = '0.0%'
    wo.cell(i, 6, f'=IF(E{i}>0.05,"Acima do orçamento",IF(E{i}<-0.05,"Abaixo","Dentro"))')
wo.cell(len(real) + 3, 1, 'TODO: substitua o orçado (fictício = realizado -5%) pelo orçamento da sua análise e comente os desvios.').font = NOTE
style_header(wo, 6)
wb.save('web/public/templates/dre-fluxo-caixa.xlsx')
print('xlsx gerados:', os.listdir('web/public/data'), os.listdir('web/public/templates'))
