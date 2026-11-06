# Roteiro do arquivo vendas.pbix
Fonte: PostgreSQL (Supabase) → schema treinamento (modo Importar).

Página 1 – Visão Executiva
- Cartões: Receita, Margem %, Pedidos, Ticket Médio
- Linha: Receita por mês | Barras: Receita por categoria | Mapa/barras: Receita por UF
- Segmentações: Ano, Canal

Página 2 – Clientes
- Matriz Segmento x Canal, Top 10 clientes, RFM (se já existir)

Página 3 – Logística
- % Entregas no prazo por transportadora, atraso médio (dias)

Medidas mínimas (DAX):
Receita = SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * fato_itens_pedido[preco_unitario])
Pedidos = DISTINCTCOUNT(fato_pedidos[pedido_id])
Ticket Médio = DIVIDE([Receita], [Pedidos])

Checklist de entrega: nome de abas claro, título-conclusão, cores consistentes, sem poluição, tooltip, bookmark de reset.
Exporte o .pbix e anexe o link (OneDrive/Drive) na submissão.
