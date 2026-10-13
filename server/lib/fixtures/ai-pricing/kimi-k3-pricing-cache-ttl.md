# Kimi K3 pricing

<DocTable
  columns={[
    { title: "Model", width: "12%" },
    { title: "Unit", width: "10%" },
    { title: "Cache Write Price (TTL 5min)", width: "13%" },
    { title: "Cache Write Price (TTL 1h)", width: "13%" },
    { title: "Cached Input Price", width: "13%" },
    { title: "Input Price", width: "13%" },
    { title: "Output Price", width: "10%" },
    { title: "Context Window", width: "16%" },
  ]}
  rows={[
    ["kimi-k3", "1M tokens", <>{"$"}3.00</>, <>{"$"}6.00</>, <>{"$"}0.30</>, <>{"$"}3.00</>, <>{"$"}15.00</>, "1,048,576 tokens"],
  ]}
/>

If no TTL is specified, the 5min tier applies by default.
