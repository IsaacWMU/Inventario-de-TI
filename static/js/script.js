
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

async function carregarAtivos() {
    ativos = await requisicao("/api/ativos");

    $("#total-ativos").textContent = ativos.length;
    $("#total-manutencao").textContent = ativos.filter(
        (ativo) => ativo.status === "Em manutenção"
    ).length;

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