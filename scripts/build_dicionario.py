"""Gera o dicionário de dados (content/dicionario.json) em Excel: arquivo próprio e aba DICIONARIO dentro do dataset.
Rode depois de build_excel.py: python3 scripts/build_dicionario.py"""
import json, os
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

D = json.load(open('content/dicionario.json', encoding='utf-8'))
HEAD = PatternFill('solid', fgColor='1E3A8A'); HF = Font(bold=True, color='FFFFFF')
BAND = PatternFill('solid', fgColor='E8EEFB'); WRAP = Alignment(wrap_text=True, vertical='top')

def header(ws, row, labels, widths=None):
    for i, l in enumerate(labels, 1):
        c = ws.cell(row, i, l); c.fill = HEAD; c.font = HF; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    if widths:
        for i, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(i)].width = w

def fill_colunas(ws):
    ws['A1'] = D['titulo']; ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = D['intro']; ws['A2'].alignment = Alignment(wrap_text=True); ws.merge_cells('A2:F2'); ws.row_dimensions[2].height = 34
    header(ws, 4, ['Tabela', 'Coluna', 'Tipo', 'O que significa', 'Valores possíveis / exemplo', 'Atenção'], [20, 20, 18, 46, 52, 60])
    r = 5
    for t in D['tabelas']:
        ws.cell(r, 1, f"{t['nome']}  ·  {t['tipo']}  ·  {t['linhas']:,} linhas".replace(',', '.')).font = Font(bold=True)
        ws.cell(r, 4, f"{t['granularidade']}. {t['uso']}")
        for c in range(1, 7): ws.cell(r, c).fill = BAND
        ws.cell(r, 4).alignment = WRAP; ws.row_dimensions[r].height = 32; r += 1
        for col in t['colunas']:
            ws.cell(r, 1, t['nome'])
            for i, v in enumerate(col, 2): ws.cell(r, i, v).alignment = WRAP
            ws.cell(r, 2).font = Font(bold=True); r += 1
    ws.freeze_panes = 'A5'

def add_sheets(wb, only_dict=False):
    ws = wb.create_sheet('DICIONARIO', 1 if only_dict else 1)
    fill_colunas(ws)
    if not only_dict: return
    ws2 = wb.create_sheet('RELACOES')
    ws2['A1'] = 'Como as tabelas se ligam'; ws2['A1'].font = Font(bold=True, size=14)
    header(ws2, 3, ['Tabela A', 'Tabela B', 'Coluna de ligação', 'Cardinalidade', 'Observação'], [34, 22, 20, 18, 80])
    for i, row in enumerate(D['relacoes'], 4):
        for j, v in enumerate(row, 1): ws2.cell(i, j, v).alignment = WRAP
    ws3 = wb.create_sheet('CUIDADOS')
    ws3['A1'] = 'Cuidados e regras de cálculo'; ws3['A1'].font = Font(bold=True, size=14)
    header(ws3, 3, ['Tema', 'O que fazer'], [28, 120])
    for i, row in enumerate(D['cuidados'], 4):
        for j, v in enumerate(row, 1): ws3.cell(i, j, v).alignment = WRAP
        ws3.cell(i, 1).font = Font(bold=True)

# 1) arquivo próprio
wb = Workbook(); wb.remove(wb.active)
ws = wb.create_sheet('LEIAME')
ws['A1'] = D['titulo']; ws['A1'].font = Font(bold=True, size=14)
for i, l in enumerate(['Abas: DICIONARIO (cada coluna de cada tabela) · RELACOES (como as tabelas se ligam) · CUIDADOS (regras de cálculo e armadilhas).',
                       D['intro']], 2): ws.cell(i, 1, l)
ws.column_dimensions['A'].width = 130
add_sheets(wb, only_dict=True)
os.makedirs('web/public/templates', exist_ok=True)
wb.save('web/public/templates/dicionario-dados.xlsx')

# 2) aba DICIONARIO dentro do dataset (idempotente)
p = 'web/public/data/dataset_treinamento.xlsx'
ds = load_workbook(p)
if 'DICIONARIO' in ds.sheetnames: del ds['DICIONARIO']
add_sheets(ds)
ds['LEIAME'].cell(6, 1, 'Veja a aba DICIONARIO: significado de cada coluna, valores possíveis e cuidados de cálculo.')
ds.save(p)
print('ok')
