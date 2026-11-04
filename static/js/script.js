
const $ = (seletor) => document.querySelector(seletor);

const mensagem = $("#mensagem");

let blocos = [];
let andares = [];
let salas = [];
let categorias = [];
let ativos = [];
let ativoEmEdicao = null;

async function requisicao(url, opcoes = {}) {
    const metodo = (opcoes.method || "GET").toUpperCase();
    const tokenCSRF = document.querySelector(
        'meta[name="csrf-token"]'
    )?.content;

    const headers = {
        ...(opcoes.body ? {
            "Content-Type": "application/json"
        } : {}),
        ...opcoes.headers
    };

    if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(metodo)) {
        if (!tokenCSRF) {
            throw new Error(
                "Token de segurança ausente. Atualize a página."
            );
        }

        headers["X-CSRFToken"] = tokenCSRF;
    }

    const resposta = await fetch(url, {
        ...opcoes,
        method: metodo,
        headers,
        credentials: "same-origin"
    });

    if (resposta.status === 401 && url.startsWith("/api/")) {
        window.location.assign("/login");
        throw new Error(
            "Sua sessão expirou. Entre novamente."
        );
    }

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
        throw new Error(
            dados.erro ||
            dados.message ||
            `Erro na requisição (${resposta.status}).`
        );
    }

    return dados;
}

function mostrarMensagem(texto, tipo = "success") {
    mensagem.textContent = texto;
    mensagem.className = `message ${tipo}`;
    mensagem.hidden = false;

    mensagem.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

function tratarErro(error) {
    console.error(error);
    mostrarMensagem(error.message || "Ocorreu um erro inesperado.", "error");
}

function preencherSelect(seletor, itens, textoInicial, valor, rotulo) {
    const select = $(seletor);
    const valorAnterior = select.value;

    select.replaceChildren();

    const opcaoInicial = document.createElement("option");
    opcaoInicial.value = "";
    opcaoInicial.textContent = textoInicial;
    select.append(opcaoInicial);

    itens.forEach((item) => {
        const opcao = document.createElement("option");
        opcao.value = item[valor];
        opcao.textContent = rotulo(item);
        select.append(opcao);
    });

    if (itens.some((item) => String(item[valor]) === valorAnterior)) {
        select.value = valorAnterior;
    }
}

function obterFormulario(formulario) {
    return Object.fromEntries(new FormData(formulario).entries());
}

function numeroOuNulo(valor) {
    return valor === "" || valor == null ? null : Number(valor);
}

function atualizarAndares(selectBloco, selectAndar) {
    const blocoId = $(selectBloco).value;

    const disponiveis = andares.filter(
        (andar) => String(andar.bloco_id) === blocoId
    );

    preencherSelect(
        selectAndar,
        disponiveis,
        "Selecione um andar",
        "id",
        (andar) => andar.nome
    );

    $(selectAndar).disabled = disponiveis.length === 0;
}

function atualizarSalas(selectAndar, selectSala, permitirSemSala = false) {
    const andarId = $(selectAndar).value;

    const disponiveis = salas.filter(
        (sala) => String(sala.andar_id) === andarId
    );

    preencherSelect(
        selectSala,
        disponiveis,
        permitirSemSala ? "Sem sala definida" : "Selecione uma sala",
        "id",
        (sala) => sala.codigo
            ? `${sala.nome} (${sala.codigo})`
            : sala.nome
    );

    $(selectSala).disabled = !andarId || disponiveis.length === 0;
}

function atualizarSeletoresDeAtivos() {
    preencherSelect(
        "#ativo-categoria",
        categorias,
        "Selecione uma categoria",
        "id",
        (categoria) => categoria.nome
    );

    preencherSelect(
        "#filtro-categoria",
        categorias,
        "Todas as categorias",
        "id",
        (categoria) => categoria.nome
    );
}

function atualizarFiltrosLocalizacao() {
    preencherSelect(
        "#filtro-bloco",
        blocos,
        "Todos os blocos",
        "id",
        (bloco) => bloco.nome
    );

    preencherSelect(
        "#filtro-andar",
        andares,
        "Todos os andares",
        "id",
        (andar) => {
            const bloco = blocos.find(
                (item) => String(item.id) === String(andar.bloco_id)
            );

            return bloco
                ? `${andar.nome} — ${bloco.nome}`
                : andar.nome;
        }
    );

    preencherSelect(
        "#filtro-sala",
        salas,
        "Todas as salas",
        "id",
        (sala) => {
            const andar = andares.find(
                (item) => String(item.id) === String(sala.andar_id)
            );

            const bloco = andar
                ? blocos.find(
                    (item) => String(item.id) === String(andar.bloco_id)
                )
                : null;

            const nomeSala = sala.codigo
                ? `${sala.nome} (${sala.codigo})`
                : sala.nome;

            const localizacao = [
                bloco?.nome,
                andar?.nome
            ].filter(Boolean).join(" / ");

            return localizacao
                ? `${nomeSala} — ${localizacao}`
                : nomeSala;
        }
    );
}

async function carregarLocalizacoes() {
    const resultados = await Promise.all([
        requisicao("/api/blocos"),
        requisicao("/api/andares"),
        requisicao("/api/salas")
    ]);

    [blocos, andares, salas] = resultados;

    preencherSelect(
        "#planta-bloco",
        blocos,
        "Selecione um bloco",
        "id",
        (bloco) => bloco.nome
    );

    atualizarAndares("#planta-bloco", "#planta-andar");

    preencherSelect(
        "#andar-bloco",
        blocos,
        "Selecione um bloco",
        "id",
        (item) => item.nome
    );

    preencherSelect(
        "#sala-bloco",
        blocos,
        "Selecione um bloco",
        "id",
        (item) => item.nome
    );

    preencherSelect(
        "#ativo-bloco",
        blocos,
        "Sem localização",
        "id",
        (item) => item.nome
    );

    atualizarAndares("#sala-bloco", "#sala-andar");
    atualizarAndares("#ativo-bloco", "#ativo-andar");

    atualizarSalas("#ativo-andar", "#ativo-sala", true);

    $("#total-blocos").textContent = blocos.length;
    $("#total-salas").textContent = salas.length;

    atualizarFiltrosLocalizacao();
    renderizarTabela();
}

async function carregarCategorias() {
    categorias = await requisicao("/api/categorias");

    atualizarSeletoresDeAtivos();
}

function atualizarIndicadores() {
    $("#total-ativos").textContent = ativos.length;

    const quantidadePorStatus = {
        "Ativo": 0,
        "Em manutenção": 0,
        "Inativo": 0,
        "Baixado": 0
    };

    ativos.forEach((ativo) => {
        if (
            Object.prototype.hasOwnProperty.call(
                quantidadePorStatus,
                ativo.status
            )
        ) {
            quantidadePorStatus[ativo.status]++;
        }
    });

    $("#total-status-ativo").textContent =
        quantidadePorStatus["Ativo"];

    $("#total-manutencao").textContent =
        quantidadePorStatus["Em manutenção"];

    $("#total-status-inativo").textContent =
        quantidadePorStatus["Inativo"];

    $("#total-status-baixado").textContent =
        quantidadePorStatus["Baixado"];
    
    renderizarGraficoStatus();
    renderizarGraficoCategoria();
    renderizarGraficoBloco();
}

function renderizarGraficoStatus() {
    const elemento = $("#grafico-status");

    const status = [
        { nome: "Ativo", classe: "ativo" },
        { nome: "Em manutenção", classe: "manutencao" },
        { nome: "Inativo", classe: "inativo" },
        { nome: "Baixado", classe: "baixado" }
    ];

    const total = ativos.length;

    const quantidadePorStatus = status.map((item) => {
        const quantidade = ativos.filter(
            (ativo) => ativo.status === item.nome
        ).length;

        const percentual = total > 0
            ? (quantidade / total) * 100
            : 0;

        return {
            ...item,
            quantidade,
            percentual
        };
    });

    elemento.innerHTML = quantidadePorStatus.map((item) => `
        <div class="status-item">
            <div class="status-info">
                <span>${item.nome}</span>
                <strong>${item.quantidade}</strong>
            </div>

            <div
                class="status-bar-background"
                role="progressbar"
                aria-label="${item.nome}"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="${item.percentual.toFixed(1)}"
            >
                <div
                    class="status-bar ${item.classe}"
                    style="width: ${item.percentual}%"
                ></div>
            </div>

            <small>${item.percentual.toFixed(1)}%</small>
        </div>
    `).join("");
}

function renderizarGraficoCategoria() {
    const elemento = $("#grafico-categoria");
    const quantidadePorCategoria = {};

    ativos.forEach((ativo) => {
        const categoria = String(
            ativo.categoria || "Sem categoria"
        );

        quantidadePorCategoria[categoria] =
            (quantidadePorCategoria[categoria] || 0) + 1;
    });

    const categoriasOrdenadas = Object.entries(
        quantidadePorCategoria
    ).sort((a, b) => b[1] - a[1]);

    elemento.replaceChildren();

    if (categoriasOrdenadas.length === 0) {
        const mensagem = document.createElement("p");
        mensagem.textContent = "Nenhum equipamento cadastrado.";
        elemento.appendChild(mensagem);
        return;
    }

    categoriasOrdenadas.forEach(([categoria, quantidade]) => {
        const percentual = ativos.length > 0
            ? (quantidade / ativos.length) * 100
            : 0;

        const item = document.createElement("div");
        item.className = "category-item";

        const cabecalho = document.createElement("div");
        cabecalho.className = "category-info";

        const nome = document.createElement("span");
        nome.textContent = categoria;

        const total = document.createElement("strong");
        total.textContent = quantidade;

        cabecalho.append(nome, total);

        const fundo = document.createElement("div");
        fundo.className = "category-bar-background";
        fundo.setAttribute("role", "progressbar");
        fundo.setAttribute("aria-label", categoria);
        fundo.setAttribute("aria-valuemin", "0");
        fundo.setAttribute("aria-valuemax", "100");
        fundo.setAttribute("aria-valuenow", percentual.toFixed(1));

        const barra = document.createElement("div");
        barra.className = "category-bar";
        barra.style.width = `${percentual}%`;

        fundo.appendChild(barra);

        const legenda = document.createElement("small");
        legenda.textContent = `${percentual.toFixed(1)}%`;

        item.append(cabecalho, fundo, legenda);
        elemento.appendChild(item);
    });
}

function renderizarGraficoBloco() {
    const elemento = $("#grafico-bloco");
    const quantidadePorBloco = {};

    ativos.forEach((ativo) => {
        const bloco = String(
            ativo.bloco || "Sem bloco"
        );

        quantidadePorBloco[bloco] =
            (quantidadePorBloco[bloco] || 0) + 1;
    });

    const blocosOrdenados = Object.entries(
        quantidadePorBloco
    ).sort((a, b) => b[1] - a[1]);

    elemento.replaceChildren();

    if (blocosOrdenados.length === 0) {
        const mensagem = document.createElement("p");
        mensagem.textContent = "Nenhum equipamento cadastrado.";
        elemento.appendChild(mensagem);
        return;
    }

    blocosOrdenados.forEach(([bloco, quantidade]) => {
        const percentual = ativos.length > 0
            ? (quantidade / ativos.length) * 100
            : 0;

        const item = document.createElement("div");
        item.className = "block-item";

        const cabecalho = document.createElement("div");
        cabecalho.className = "block-info";

        const nome = document.createElement("span");
        nome.textContent = bloco;

        const total = document.createElement("strong");
        total.textContent = quantidade;

        cabecalho.append(nome, total);

        const fundo = document.createElement("div");
        fundo.className = "block-bar-background";
        fundo.setAttribute("role", "progressbar");
        fundo.setAttribute("aria-label", bloco);
        fundo.setAttribute("aria-valuemin", "0");
        fundo.setAttribute("aria-valuemax", "100");
        fundo.setAttribute("aria-valuenow", percentual.toFixed(1));

        const barra = document.createElement("div");
        barra.className = "block-bar";
        barra.style.width = `${percentual}%`;

        fundo.appendChild(barra);

        const legenda = document.createElement("small");
        legenda.textContent = `${percentual.toFixed(1)}%`;

        item.append(cabecalho, fundo, legenda);
        elemento.appendChild(item);
    });
}

async function carregarAtivos() {
    ativos = await requisicao("/api/ativos");

    atualizarIndicadores();
    renderizarTabela();
}

function adicionarCelula(linha, valor) {
    const celula = document.createElement("td");
    celula.textContent = valor || "—";
    linha.append(celula);
}

function obterAtivosFiltrados() {
    const termo = $("#busca").value
        .trim()
        .toLocaleLowerCase("pt-BR");

    const categoriaId = $("#filtro-categoria").value;
    const status = $("#filtro-status").value;
    const blocoId = $("#filtro-bloco").value;
    const andarId = $("#filtro-andar").value;
    const salaId = $("#filtro-sala").value;

    return ativos.filter((ativo) => {
        const sala = salas.find(
            (item) => String(item.id) === String(ativo.sala_id)
        );

        const andar = sala
            ? andares.find(
                (item) => String(item.id) === String(sala.andar_id)
            )
            : null;

        const bloco = andar
            ? blocos.find(
                (item) => String(item.id) === String(andar.bloco_id)
            )
            : null;

        const texto = [
            ativo.nome,
            ativo.patrimonio,
            ativo.numero_serie,
            ativo.fabricante,
            ativo.modelo,
            ativo.hostname,
            ativo.endereco_ip,
            ativo.sistema_operacional,
            ativo.memoria_ram_gb,
            ativo.categoria,
            ativo.sala,
            ativo.andar,
            ativo.bloco,
            ativo.status,
            ativo.observacoes
        ]
            .filter((valor) => valor !== null && valor !== undefined)
            .join(" ")
            .toLocaleLowerCase("pt-BR");

        return (
            (!termo || texto.includes(termo)) &&
            (!categoriaId ||
                String(ativo.categoria_id) === categoriaId) &&
            (!status || ativo.status === status) &&
            (!blocoId ||
                String(bloco?.id ?? "") === blocoId) &&
            (!andarId ||
                String(andar?.id ?? "") === andarId) &&
            (!salaId ||
                String(ativo.sala_id ?? "") === salaId)
        );
    });
}

function exportarCSV() {
    const equipamentos = obterAtivosFiltrados();

    if (equipamentos.length === 0) {
        mostrarMensagem(
            "Não há equipamentos para exportar com os filtros atuais.",
            "error"
        );
        return;
    }

    const colunas = [
        ["Nome", "nome"],
        ["Patrimônio", "patrimonio"],
        ["Número de série", "numero_serie"],
        ["Categoria", "categoria"],
        ["Fabricante", "fabricante"],
        ["Modelo", "modelo"],
        ["Hostname", "hostname"],
        ["Endereço IP", "endereco_ip"],
        ["Sistema operacional", "sistema_operacional"],
        ["Memória RAM (GB)", "memoria_ram_gb"],
        ["Bloco", "bloco"],
        ["Andar", "andar"],
        ["Sala", "sala"],
        ["Status", "status"],
        ["Observações", "observacoes"],
        ["Criado em", "criado_em"],
        ["Atualizado em", "atualizado_em"]
    ];

    function protegerValorCSV(valor) {
        let texto = valor == null ? "" : String(valor);

        // Evita que valores sejam interpretados como fórmulas
        // ao abrir o CSV em um programa de planilhas.
        if (/^[\s]*[=+\-@]/.test(texto)) {
            texto = "'" + texto;
        }

        // Escapa aspas para o formato CSV.
        return `"${texto.replace(/"/g, '""')}"`;
    }

    const linhas = [
        colunas.map(([titulo]) => protegerValorCSV(titulo)),
        ...equipamentos.map((ativo) =>
            colunas.map(([, campo]) =>
                protegerValorCSV(ativo[campo])
            )
        )
    ];

    // BOM UTF-8 ajuda o Excel a reconhecer acentos.
    const conteudo = "\uFEFF" +
        linhas.map((linha) => linha.join(";")).join("\r\n");

    const arquivo = new Blob(
        [conteudo],
        { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");

    link.href = url;
    link.download = "inventario_ti.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
    mostrarMensagem(
        `${equipamentos.length} equipamento(s) exportado(s) para CSV.`
    );
}

function exportarExcel() {
    const parametros = new URLSearchParams();

    parametros.set("busca", $("#busca").value.trim());
    parametros.set("categoria", $("#filtro-categoria").value);
    parametros.set("status", $("#filtro-status").value);
    parametros.set("bloco", $("#filtro-bloco").value);
    parametros.set("andar", $("#filtro-andar").value);
    parametros.set("sala", $("#filtro-sala").value);

    const url = `/api/ativos/exportar-xlsx?${parametros.toString()}`;

    window.location.href = url;
}

function renderizarTabela() {
    const filtrados = obterAtivosFiltrados();

    const tabela = $("#tabela-ativos");
    tabela.replaceChildren();

    if (filtrados.length === 0) {
        const linha = document.createElement("tr");
        const celula = document.createElement("td");

        celula.colSpan = 7;
        celula.textContent = ativos.length
            ? "Nenhum equipamento corresponde aos filtros."
            : "Nenhum equipamento cadastrado.";

        linha.append(celula);
        tabela.append(linha);
    }

    filtrados.forEach((ativo) => {
        const linha = document.createElement("tr");

        adicionarCelula(linha, ativo.nome);
        adicionarCelula(linha, ativo.patrimonio);
        adicionarCelula(linha, ativo.categoria);

        const localizacao = [
            ativo.bloco,
            ativo.andar,
            ativo.sala
        ].filter(Boolean).join(" / ");

        adicionarCelula(
            linha,
            localizacao || "Sem localização"
        );

        const rede = [
            ativo.hostname,
            ativo.endereco_ip
        ].filter(Boolean).join(" / ");

        adicionarCelula(linha, rede);

        const celulaStatus = document.createElement("td");
        const etiqueta = document.createElement("span");

        etiqueta.classList.add("status");

        const classes = {
            "Ativo": "status-ativo",
            "Em manutenção": "status-manutencao",
            "Inativo": "status-inativo",
            "Baixado": "status-baixado"
        };

        etiqueta.classList.add(
            classes[ativo.status] || "status-inativo"
        );

        etiqueta.textContent = ativo.status;
        celulaStatus.append(etiqueta);
        linha.append(celulaStatus);

        const celulaAcoes = document.createElement("td");
        const grupoAcoes = document.createElement("div");

        grupoAcoes.className = "action-buttons";

        const botaoEditar = document.createElement("button");
        botaoEditar.type = "button";
        botaoEditar.className = "edit-button";
        botaoEditar.textContent = "Editar";
        botaoEditar.addEventListener(
            "click",
            () => editarAtivo(ativo.id)
        );

        const botaoHistorico = document.createElement("button");
        botaoHistorico.type = "button";
        botaoHistorico.className = "history-button";
        botaoHistorico.textContent = "Histórico";
        botaoHistorico.addEventListener(
            "click",
            () => carregarHistorico(ativo.id)
        );

        grupoAcoes.append(botaoEditar, botaoHistorico);
        celulaAcoes.append(grupoAcoes);
        linha.append(celulaAcoes);

        tabela.append(linha);
    });

    $("#contador-lista").textContent =
        `${filtrados.length} de ${ativos.length} equipamento(s)`;
}

async function enviarFormulario(formulario, url, prepararDados, sucesso) {
    const botao = formulario.querySelector('[type="submit"]');

    botao.disabled = true;

    try {
        const dados = prepararDados();

        await requisicao(url, {
            method: "POST",
            body: JSON.stringify(dados)
        });

        formulario.reset();

        await sucesso();

        mostrarMensagem("Cadastro realizado com sucesso.");
    } catch (error) {
        tratarErro(error);
    } finally {
        botao.disabled = false;
    }
}

$("#exportar-csv").addEventListener("click", exportarCSV);

$("#exportar-xlsx").addEventListener("click", exportarExcel);

$("#form-bloco").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarFormulario(
        evento.currentTarget,
        "/api/blocos",
        () => obterFormulario(evento.currentTarget),
        async () => {
            await carregarLocalizacoes();
        }
    );
});

$("#form-andar").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarFormulario(
        evento.currentTarget,
        "/api/andares",
        () => {
            const dados = obterFormulario(evento.currentTarget);
            dados.bloco_id = Number(dados.bloco_id);
            return dados;
        },
        async () => {
            await carregarLocalizacoes();
        }
    );
});

$("#form-sala").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarFormulario(
        evento.currentTarget,
        "/api/salas",
        () => {
            const dados = obterFormulario(evento.currentTarget);
            dados.andar_id = Number(dados.andar_id);
            return dados;
        },
        async () => {
            await carregarLocalizacoes();
        }
    );
});

$("#form-ativo").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    const formulario = evento.currentTarget;
    const botao = formulario.querySelector('[type="submit"]');

    if (!formulario.reportValidity()) {
        return;
    }

    botao.disabled = true;

    try {
        const dados = obterFormulario(formulario);

        dados.categoria_id = Number(dados.categoria_id);
        dados.sala_id = numeroOuNulo(dados.sala_id);
        dados.memoria_ram_gb = numeroOuNulo(dados.memoria_ram_gb);

        const editando = ativoEmEdicao !== null;

        const url = editando
            ? `/api/ativos/${ativoEmEdicao}`
            : "/api/ativos";

        await requisicao(url, {
            method: editando ? "PUT" : "POST",
            body: JSON.stringify(dados)
        });

        cancelarEdicao();

        await carregarAtivos();

        mostrarMensagem(
            editando
                ? "Equipamento atualizado com sucesso."
                : "Equipamento cadastrado com sucesso."
        );
    } catch (error) {
        tratarErro(error);
    } finally {
        botao.disabled = false;
    }
});

$("#sala-bloco").addEventListener("change", () => {
    atualizarAndares("#sala-bloco", "#sala-andar");
    atualizarSalas("#sala-andar", "#sala-sala", false);
});

$("#sala-andar").addEventListener("change", () => {
    atualizarSalas("#sala-andar", "#sala-sala", false);
});

$("#ativo-bloco").addEventListener("change", () => {
    atualizarAndares("#ativo-bloco", "#ativo-andar");
    atualizarSalas("#ativo-andar", "#ativo-sala", true);
});

$("#ativo-andar").addEventListener("change", () => {
    atualizarSalas("#ativo-andar", "#ativo-sala", true);
});


$("#busca").addEventListener("input", renderizarTabela);
[
    "#filtro-categoria",
    "#filtro-status",
    "#filtro-bloco",
    "#filtro-andar",
    "#filtro-sala"
].forEach((seletor) => {
    $(seletor).addEventListener("change", renderizarTabela);
});

$("#limpar-filtros").addEventListener("click", () => {
    $("#busca").value = "";
    $("#filtro-categoria").value = "";
    $("#filtro-status").value = "";
    $("#filtro-bloco").value = "";
    $("#filtro-andar").value = "";
    $("#filtro-sala").value = "";

    renderizarTabela();
});

$("#atualizar-lista").addEventListener("click", async () => {
    try {
        await Promise.all([
            carregarLocalizacoes(),
            carregarAtivos()
        ]);

        mostrarMensagem("Dados atualizados.");
    } catch (error) {
        tratarErro(error);
    }
});

$("#form-ativo").addEventListener("reset", () => {
    setTimeout(() => {
        atualizarAndares("#ativo-bloco", "#ativo-andar");
        atualizarSalas("#ativo-andar", "#ativo-sala", true);
    }, 0);
});

function definirValor(seletor, valor) {
    $(seletor).value = valor ?? "";
}

function editarAtivo(id) {
    const ativo = ativos.find((item) => item.id === id);

    if (!ativo) {
        mostrarMensagem("Equipamento não encontrado na lista.", "error");
        return;
    }

    ativoEmEdicao = id;

    const formulario = $("#form-ativo");
    const dados = {
        "ativo-nome": ativo.nome,
        "ativo-categoria": ativo.categoria_id,
        "ativo-patrimonio": ativo.patrimonio,
        "ativo-serie": ativo.numero_serie,
        "ativo-fabricante": ativo.fabricante,
        "ativo-modelo": ativo.modelo,
        "ativo-hostname": ativo.hostname,
        "ativo-ip": ativo.endereco_ip,
        "ativo-sistema": ativo.sistema_operacional,
        "ativo-ram": ativo.memoria_ram_gb,
        "ativo-status": ativo.status,
        "ativo-observacoes": ativo.observacoes
    };

    Object.entries(dados).forEach(([seletor, valor]) => {
        definirValor(`#${seletor}`, valor);
    });

    definirValor("#ativo-responsavel", "");
    definirValor("#ativo-observacao-movimentacao", "");

    const sala = salas.find(
        (item) => item.id === ativo.sala_id
    );

    const andarId = sala ? sala.andar_id : "";
    const andar = andares.find(
        (item) => item.id === andarId
    );

    const blocoId = andar ? andar.bloco_id : "";

    definirValor("#ativo-bloco", blocoId);

    atualizarAndares("#ativo-bloco", "#ativo-andar");

    definirValor("#ativo-andar", andarId);

    atualizarSalas("#ativo-andar", "#ativo-sala", true);

    definirValor("#ativo-sala", ativo.sala_id);

    $("#modo-edicao").hidden = false;

    const botaoSalvar = formulario.querySelector('[type="submit"]');
    botaoSalvar.textContent = "Salvar alterações";

    $("#secao-equipamentos").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

    mostrarMensagem(
        `Editando: ${ativo.nome}. Altere os campos e salve.`
    );
}

function cancelarEdicao() {
    ativoEmEdicao = null;

    $("#form-ativo").reset();
    $("#modo-edicao").hidden = true;

    $("#form-ativo").querySelector('[type="submit"]')
        .textContent = "Salvar equipamento";

    atualizarAndares("#ativo-bloco", "#ativo-andar");
    atualizarSalas("#ativo-andar", "#ativo-sala", true);
}

$("#cancelar-edicao").addEventListener("click", cancelarEdicao);

function formatarLocalizacao(movimentacao, prefixo) {
    const bloco = movimentacao[`${prefixo}bloco`];
    const andar = movimentacao[`${prefixo}andar`];
    const sala = movimentacao[`${prefixo}sala`];

    const partes = [bloco, andar, sala].filter(Boolean);

    return partes.length
        ? partes.join(" / ")
        : "Sem localização";
}

async function carregarHistorico(id) {
    try {
        const dados = await requisicao(
            `/api/ativos/${id}/movimentacoes`
        );

        $("#titulo-historico").textContent =
            `Histórico: ${dados.ativo.nome}`;

        $("#subtitulo-historico").textContent =
            dados.ativo.patrimonio
                ? `Patrimônio: ${dados.ativo.patrimonio}`
                : `ID do ativo: ${dados.ativo.id}`;

        const tabela = $("#tabela-historico");
        tabela.replaceChildren();

        if (dados.movimentacoes.length === 0) {
            const linha = document.createElement("tr");
            const celula = document.createElement("td");

            celula.colSpan = 5;
            celula.textContent =
                "Nenhuma movimentação registrada para este equipamento.";

            linha.append(celula);
            tabela.append(linha);
        }

        dados.movimentacoes.forEach((movimentacao) => {
            const linha = document.createElement("tr");

            const data = movimentacao.data_movimentacao || "—";

            const anterior = formatarLocalizacao(
                movimentacao,
                "anterior"
            );

            const nova = formatarLocalizacao(
                movimentacao,
                "novo"
            );

            [
                data,
                anterior,
                nova,
                movimentacao.responsavel,
                movimentacao.observacoes
            ].forEach((valor) => adicionarCelula(linha, valor));

            tabela.append(linha);
        });

        $("#secao-historico").hidden = false;

        $("#secao-historico").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } catch (error) {
        tratarErro(error);
    }
}

$("#fechar-historico").addEventListener("click", () => {
    $("#secao-historico").hidden = true;
});

function atualizarVisualizacaoPlanta() {
    const blocoId = $("#planta-bloco").value;
    const andarId = $("#planta-andar").value;
    const area = $("#planta-area");

    area.replaceChildren();

    const bloco = blocos.find(
        (item) => String(item.id) === blocoId
    );

    const andar = andares.find(
        (item) =>
            String(item.id) === andarId &&
            String(item.bloco_id) === blocoId
    );

    if (!blocoId || !bloco || !andarId || !andar) {
        const mensagem = document.createElement("div");
        mensagem.className = "planta-vazia";

        const titulo = document.createElement("h3");
        titulo.textContent = "Selecione um andar";

        const descricao = document.createElement("p");
        descricao.textContent =
            "Escolha um bloco e um andar para visualizar suas salas.";

        mensagem.append(titulo, descricao);
        area.appendChild(mensagem);
        return;
    }

    const titulo = document.createElement("div");
    titulo.className = "planta-cabecalho";

    const nome = document.createElement("h3");
    nome.textContent = `${bloco.nome} — ${andar.nome}`;

    const salasDoAndar = salas.filter(
        (sala) => String(sala.andar_id) === andarId
    );

    const contador = document.createElement("p");
    contador.textContent =
        `${salasDoAndar.length} sala(s) cadastrada(s)`;

    titulo.append(nome, contador);
    area.appendChild(titulo);

    if (salasDoAndar.length === 0) {
        const mensagem = document.createElement("div");
        mensagem.className = "planta-vazia";

        const subtitulo = document.createElement("h3");
        subtitulo.textContent = "Nenhuma sala cadastrada";

        const descricao = document.createElement("p");
        descricao.textContent =
            "Cadastre salas na seção Localizações para exibi-las aqui.";

        mensagem.append(subtitulo, descricao);
        area.appendChild(mensagem);
        return;
    }

    const mapa = document.createElement("div");
    mapa.className = "planta-mapa";

    let salaArrastada = null;

    mapa.addEventListener("dragstart", (evento) => {
        const cartao = evento.target.closest(".planta-sala");

        if (!cartao) {
            return;
        }

        salaArrastada = cartao;

        evento.dataTransfer.effectAllowed = "move";
        evento.dataTransfer.setData(
            "text/plain",
            cartao.dataset.salaId
        );

        cartao.classList.add("sala-arrastando");
    });

    mapa.addEventListener("dragover", (evento) => {
        evento.preventDefault();
        evento.dataTransfer.dropEffect = "move";
    });

    mapa.addEventListener("drop", (evento) => {
        evento.preventDefault();

        const destino = evento.target.closest(".planta-sala");

        if (
            !salaArrastada ||
            !destino ||
            destino === salaArrastada
        ) {
            return;
        }

        const retangulo = destino.getBoundingClientRect();
        const depois =
            evento.clientY > retangulo.top + retangulo.height / 2;

        mapa.insertBefore(
            salaArrastada,
            depois ? destino.nextSibling : destino
        );
    });

    mapa.addEventListener("dragend", () => {
        if (salaArrastada) {
            salaArrastada.classList.remove("sala-arrastando");
        }

        salaArrastada = null;
    });

    salasDoAndar.forEach((sala) => {
        const cartao = document.createElement("div");
        cartao.className = "planta-sala";
        cartao.dataset.salaId = sala.id;

        cartao.draggable = true;
        cartao.title = "Arraste para reorganizar esta sala.";

        const nomeSala = document.createElement("strong");
        nomeSala.textContent = sala.nome;

        const identificacao = document.createElement("span");
        identificacao.textContent = sala.codigo || "Sem código";

        cartao.append(nomeSala, identificacao);
        mapa.appendChild(cartao);
    });

    area.appendChild(mapa);
}

$("#planta-bloco").addEventListener("change", () => {
    atualizarAndares("#planta-bloco", "#planta-andar");
    atualizarVisualizacaoPlanta();
});

$("#planta-andar").addEventListener("change", () => {
    atualizarVisualizacaoPlanta();
});

async function iniciarSistema() {
    try {
        await Promise.all([
            carregarLocalizacoes(),
            carregarCategorias(),
            carregarAtivos()
        ]);
    } catch (error) {
        tratarErro(error);
    }
}

iniciarSistema();