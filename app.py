import os
import secrets
import sqlite3
import ipaddress

from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect
from datetime import timedelta, datetime
from functools import wraps
from flask import Flask, jsonify, request, render_template, redirect, url_for, session, send_file
from database import inicializar_banco, conectar_banco
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://",
)

chave_secreta = os.environ.get("FLASK_SECRET_KEY")

if not chave_secreta:
    raise RuntimeError(
        "Configure a variável de ambiente FLASK_SECRET_KEY."
    )

app.config["SECRET_KEY"] = chave_secreta

csrf = CSRFProtect(app)

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Ative em produção quando o sistema estiver usando HTTPS.
app.config["SESSION_COOKIE_SECURE"] = (
    os.environ.get("FLASK_HTTPS") == "1"
)

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(minutes=30)

def garantir_colunas_posicao_salas():
    with conectar_banco() as conexao:
        colunas = {
            coluna[1]
            for coluna in conexao.execute(
                "PRAGMA table_info(salas)"
            ).fetchall()
        }

        if "posicao_x" not in colunas:
            conexao.execute("""
                ALTER TABLE salas
                ADD COLUMN posicao_x REAL
            """)

        if "posicao_y" not in colunas:
            conexao.execute("""
                ALTER TABLE salas
                ADD COLUMN posicao_y REAL
            """)

inicializar_banco()
garantir_colunas_posicao_salas()

@app.route("/login", methods=["GET", "POST"])
@limiter.limit("5 per minute", methods=["POST"])
@limiter.limit("20 per hour", methods=["POST"])
def login():
    if request.method == "GET":
        if session.get("usuario_id"):
            return redirect(url_for("inicio"))

        return render_template("login.html")

    usuario = (request.form.get("usuario") or "").strip()
    senha = request.form.get("senha") or ""

    if not usuario or not senha:
        return render_template(
            "login.html",
            erro="Informe o usuário e a senha."
        ), 400

    with conectar_banco() as conexao:
        registro = conexao.execute(
            """
            SELECT id, nome, usuario, senha_hash, perfil, ativo
            FROM usuarios
            WHERE usuario = ?
            """,
            (usuario,)
        ).fetchone()

    if (
        registro is None
        or not registro["ativo"]
        or not check_password_hash(registro["senha_hash"], senha)
    ):
        return render_template(
            "login.html",
            erro="Usuário ou senha inválidos."
        ), 401

    # Cria uma sessão nova após a autenticação.
    session.clear()
    session.permanent = True
    session["usuario_id"] = registro["id"]
    session["nome"] = registro["nome"]
    session["usuario"] = registro["usuario"]
    session["perfil"] = registro["perfil"]

    return redirect(url_for("inicio"))

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.before_request
def exigir_autenticacao():
    endpoints_publicos = {"login", "static"}

    if request.endpoint in endpoints_publicos:
        return None

    usuario_id = session.get("usuario_id")

    if not usuario_id:
        if request.path.startswith("/api/"):
            return jsonify({
                "erro": "Sessão expirada ou autenticação necessária."
            }), 401

        return redirect(url_for("login"))

    with conectar_banco() as conexao:
        usuario = conexao.execute(
            """
            SELECT id, nome, usuario, perfil, ativo
            FROM usuarios
            WHERE id = ?
            """,
            (usuario_id,)
        ).fetchone()

    if usuario is None or not usuario["ativo"]:
        session.clear()

        if request.path.startswith("/api/"):
            return jsonify({
                "erro": "Conta inativa ou autenticação necessária."
            }), 401

        return redirect(url_for("login"))

    # Atualiza os dados da sessão com os valores do banco.
    session["nome"] = usuario["nome"]
    session["usuario"] = usuario["usuario"]
    session["perfil"] = usuario["perfil"]

    return None

STATUS_VALIDOS = {
    "Ativo",
    "Em manutenção",
    "Inativo",
    "Baixado"
}

def criar_planilha_excel(equipamentos):
    """
    Cria uma planilha XLSX formatada para o Inventário de TI.
    Recebe uma lista de dicionários com os dados dos equipamentos.
    Retorna um BytesIO pronto para ser enviado pelo Flask.
    """

    arquivo = BytesIO()
    planilha = Workbook()
    aba = planilha.active
    aba.title = "Inventário de TI"

    # Paleta institucional
    azul_escuro = "17365D"
    azul_claro = "D9EAF7"
    azul_alternado = "F3F8FC"
    branco = "FFFFFF"
    cinza = "D6DEE8"
    texto_escuro = "243447"

    preenchimento_azul = PatternFill(
        fill_type="solid",
        fgColor=azul_escuro
    )
    preenchimento_claro = PatternFill(
        fill_type="solid",
        fgColor=azul_claro
    )
    preenchimento_alternado = PatternFill(
        fill_type="solid",
        fgColor=azul_alternado
    )

    borda_fina = Border(
        left=Side(style="thin", color=cinza),
        right=Side(style="thin", color=cinza),
        top=Side(style="thin", color=cinza),
        bottom=Side(style="thin", color=cinza)
    )

    # 17 colunas: A até Q
    total_colunas = 17
    ultima_coluna = get_column_letter(total_colunas)

    # Espaço reservado para o logotipo institucional
    aba.merge_cells("A1:B3")
    celula_logo = aba["A1"]
    celula_logo.value = "LOGOTIPO\nINSTITUCIONAL"
    celula_logo.fill = preenchimento_claro
    celula_logo.font = Font(
        name="Arial",
        size=11,
        bold=True,
        color=azul_escuro
    )
    celula_logo.alignment = Alignment(
        horizontal="center",
        vertical="center",
        wrap_text=True
    )

    # Cabeçalho do relatório
    aba.merge_cells(f"C1:{ultima_coluna}1")
    aba["C1"] = "INVENTÁRIO DE TI"
    aba["C1"].fill = preenchimento_azul
    aba["C1"].font = Font(
        name="Arial",
        size=20,
        bold=True,
        color=branco
    )
    aba["C1"].alignment = Alignment(
        horizontal="center",
        vertical="center"
    )

    aba.merge_cells(f"C2:{ultima_coluna}2")
    aba["C2"] = "Relatório de controle patrimonial de equipamentos"
    aba["C2"].fill = preenchimento_azul
    aba["C2"].font = Font(
        name="Arial",
        size=11,
        color=branco
    )
    aba["C2"].alignment = Alignment(
        horizontal="center",
        vertical="center"
    )

    # Data de emissão, sem registrar os filtros utilizados
    aba.merge_cells(f"A4:{ultima_coluna}4")
    aba["A4"] = (
        "Emitido em: "
        + datetime.now().strftime("%d/%m/%Y às %H:%M")
    )
    aba["A4"].font = Font(
        name="Arial",
        size=10,
        italic=True,
        color=texto_escuro
    )
    aba["A4"].alignment = Alignment(
        horizontal="right",
        vertical="center"
    )

    # Colunas do relatório
    colunas = [
        ("Nome", "nome"),
        ("Patrimônio", "patrimonio"),
        ("Número de série", "numero_serie"),
        ("Categoria", "categoria"),
        ("Fabricante", "fabricante"),
        ("Modelo", "modelo"),
        ("Hostname", "hostname"),
        ("Endereço IP", "endereco_ip"),
        ("Sistema operacional", "sistema_operacional"),
        ("Memória RAM (GB)", "memoria_ram_gb"),
        ("Bloco", "bloco"),
        ("Andar", "andar"),
        ("Sala", "sala"),
        ("Status", "status"),
        ("Observações", "observacoes"),
        ("Criado em", "criado_em"),
        ("Atualizado em", "atualizado_em")
    ]

    linha_cabecalho = 6
    primeira_linha_dados = linha_cabecalho + 1

    for numero_coluna, (titulo, _) in enumerate(colunas, start=1):
        celula = aba.cell(
            row=linha_cabecalho,
            column=numero_coluna,
            value=titulo
        )
        celula.fill = preenchimento_azul
        celula.font = Font(
            name="Arial",
            size=10,
            bold=True,
            color=branco
        )
        celula.alignment = Alignment(
            horizontal="center",
            vertical="center",
            wrap_text=True
        )
        celula.border = borda_fina

    # Cores para cada situação do equipamento
    cores_status = {
        "Ativo": "E2F0D9",
        "Em manutenção": "FFF2CC",
        "Inativo": "DDEBF7",
        "Baixado": "F4CCCC"
    }

    # Preenche as linhas dos equipamentos
    for numero_linha, equipamento in enumerate(
        equipamentos,
        start=primeira_linha_dados
    ):
        for numero_coluna, (_, campo) in enumerate(colunas, start=1):
            valor = equipamento.get(campo)

            # Evita que textos recebidos sejam tratados como fórmulas.
            if isinstance(valor, str) and valor.lstrip().startswith(
                ("=", "+", "-", "@")
            ):
                valor = "'" + valor

            celula = aba.cell(
                row=numero_linha,
                column=numero_coluna,
                value=valor
            )

            celula.font = Font(
                name="Arial",
                size=10,
                color=texto_escuro
            )
            celula.alignment = Alignment(
                vertical="top",
                wrap_text=True
            )
            celula.border = borda_fina

            if numero_linha % 2 == 0:
                celula.fill = preenchimento_alternado

            # Destaca visualmente o status
            if campo == "status" and equipamento.get("status"):
                cor = cores_status.get(equipamento["status"])

                if cor:
                    celula.fill = PatternFill(
                        fill_type="solid",
                        fgColor=cor
                    )
                    celula.font = Font(
                        name="Arial",
                        size=10,
                        bold=True,
                        color=texto_escuro
                    )
                    celula.alignment = Alignment(
                        horizontal="center",
                        vertical="center"
                    )

    # Larguras adequadas para leitura
    larguras = [
        25, 18, 22, 20, 20, 20, 22, 18, 25,
        18, 18, 15, 20, 20, 40, 22, 22
    ]

    for numero_coluna, largura in enumerate(larguras, start=1):
        letra = get_column_letter(numero_coluna)
        aba.column_dimensions[letra].width = largura

    # Altura das linhas do cabeçalho
    aba.row_dimensions[1].height = 30
    aba.row_dimensions[2].height = 24
    aba.row_dimensions[3].height = 22
    aba.row_dimensions[4].height = 22
    aba.row_dimensions[linha_cabecalho].height = 36

    # Congela o cabeçalho e habilita os filtros do Excel
    aba.freeze_panes = "A7"
    aba.auto_filter.ref = (
        f"A{linha_cabecalho}:{ultima_coluna}"
        f"{max(linha_cabecalho, aba.max_row)}"
    )

    # Configuração de impressão
    aba.sheet_properties.pageSetUpPr.fitToPage = True
    aba.page_setup.orientation = "landscape"
    aba.page_setup.fitToWidth = 1
    aba.page_setup.fitToHeight = 0
    aba.page_margins.left = 0.25
    aba.page_margins.right = 0.25
    aba.print_title_rows = "1:6"
    aba.print_area = (
        f"A1:{ultima_coluna}"
        f"{max(linha_cabecalho, aba.max_row)}"
    )

    # Metadados do arquivo
    planilha.properties.title = "Inventário de TI"
    planilha.properties.subject = "Controle patrimonial de equipamentos"
    planilha.properties.creator = "Inventário de TI"

    planilha.save(arquivo)
    arquivo.seek(0)

    return arquivo

def erro(mensagem, codigo=400):
    return jsonify({"erro": mensagem}), codigo


def obter_dados():
    if not request.is_json:
        return None

    dados = request.get_json(silent=True)

    if not isinstance(dados, dict):
        return None

    return dados


def texto_obrigatorio(dados, campo):
    valor = dados.get(campo)

    if not isinstance(valor, str) or not valor.strip():
        raise ValueError(f"O campo '{campo}' é obrigatório.")

    return valor.strip()


def inteiro_obrigatorio(dados, campo):
    valor = dados.get(campo)

    if isinstance(valor, bool):
        raise ValueError(f"O campo '{campo}' deve ser um número inteiro.")

    try:
        numero = int(valor)
    except (TypeError, ValueError):
        raise ValueError(
            f"O campo '{campo}' deve ser um número inteiro."
        )

    if numero <= 0:
        raise ValueError(f"O campo '{campo}' deve ser maior que zero.")

    return numero


def inteiro_opcional(dados, campo):
    valor = dados.get(campo)

    if valor is None or valor == "":
        return None

    if isinstance(valor, bool):
        raise ValueError(f"O campo '{campo}' deve ser um número inteiro.")

    try:
        numero = int(valor)
    except (TypeError, ValueError):
        raise ValueError(
            f"O campo '{campo}' deve ser um número inteiro."
        )

    if numero <= 0:
        raise ValueError(f"O campo '{campo}' deve ser maior que zero.")

    return numero


def texto_opcional(dados, campo):
    valor = dados.get(campo)

    if valor is None:
        return None

    if not isinstance(valor, str):
        raise ValueError(f"O campo '{campo}' deve ser um texto.")

    valor = valor.strip()
    return valor or None

def validar_ip(valor):
    if valor is None:
        return None

    try:
        return str(ipaddress.ip_address(valor))
    except ValueError:
        raise ValueError("O endereço IP informado não é válido.")

@app.route("/")
def inicio():
    return render_template("index.html")


@app.route("/api/status")
def status_sistema():
    with conectar_banco() as conexao:
        total_ativos = conexao.execute(
            "SELECT COUNT(*) FROM ativos"
        ).fetchone()[0]

        total_categorias = conexao.execute(
            "SELECT COUNT(*) FROM categorias"
        ).fetchone()[0]

    return jsonify({
        "sistema": "Inventário de TI",
        "banco": "conectado",
        "total_ativos": total_ativos,
        "total_categorias": total_categorias
    })


# -------------------------
# CATEGORIAS
# -------------------------

@app.route("/api/categorias", methods=["GET"])
def listar_categorias():
    with conectar_banco() as conexao:
        registros = conexao.execute("""
            SELECT id, nome
            FROM categorias
            ORDER BY nome
        """).fetchall()

    return jsonify([dict(item) for item in registros])


# -------------------------
# BLOCOS
# -------------------------

@app.route("/api/blocos", methods=["GET"])
def listar_blocos():
    with conectar_banco() as conexao:
        registros = conexao.execute("""
            SELECT id, nome, descricao
            FROM blocos
            WHERE ativo = 1
            ORDER BY nome
        """).fetchall()

    return jsonify([dict(item) for item in registros])


@app.route("/api/blocos", methods=["POST"])
def cadastrar_bloco():
    dados = obter_dados()

    if dados is None:
        return erro("Envie os dados no formato JSON.")

    try:
        nome = texto_obrigatorio(dados, "nome")
        descricao = texto_opcional(dados, "descricao")

        with conectar_banco() as conexao:
            cursor = conexao.execute("""
                INSERT INTO blocos (nome, descricao)
                VALUES (?, ?)
            """, (nome, descricao))

            bloco_id = cursor.lastrowid

        return jsonify({
            "mensagem": "Bloco cadastrado com sucesso.",
            "id": bloco_id,
            "nome": nome
        }), 201

    except ValueError as exc:
        return erro(str(exc))
    except sqlite3.IntegrityError:
        return erro("Já existe um bloco com esse nome.", 409)


# -------------------------
# ANDARES
# -------------------------

@app.route("/api/andares", methods=["GET"])
def listar_andares():
    with conectar_banco() as conexao:
        registros = conexao.execute("""
            SELECT
                a.id,
                a.nome,
                a.bloco_id,
                b.nome AS bloco
            FROM andares a
            JOIN blocos b ON b.id = a.bloco_id
            ORDER BY b.nome, a.nome
        """).fetchall()

    return jsonify([dict(item) for item in registros])


@app.route("/api/andares", methods=["POST"])
def cadastrar_andar():
    dados = obter_dados()

    if dados is None:
        return erro("Envie os dados no formato JSON.")

    try:
        nome = texto_obrigatorio(dados, "nome")
        bloco_id = inteiro_obrigatorio(dados, "bloco_id")

        with conectar_banco() as conexao:
            bloco = conexao.execute("""
                SELECT id FROM blocos
                WHERE id = ? AND ativo = 1
            """, (bloco_id,)).fetchone()

            if bloco is None:
                return erro("Bloco não encontrado ou inativo.", 404)

            cursor = conexao.execute("""
                INSERT INTO andares (bloco_id, nome)
                VALUES (?, ?)
            """, (bloco_id, nome))

            andar_id = cursor.lastrowid

        return jsonify({
            "mensagem": "Andar cadastrado com sucesso.",
            "id": andar_id,
            "nome": nome,
            "bloco_id": bloco_id
        }), 201

    except ValueError as exc:
        return erro(str(exc))
    except sqlite3.IntegrityError:
        return erro("Esse andar já existe nesse bloco.", 409)


# -------------------------
# SALAS
# -------------------------

@app.route("/api/salas", methods=["GET"])
def listar_salas():
    with conectar_banco() as conexao:
        registros = conexao.execute("""
            SELECT
                s.id,
                s.nome,
                s.codigo,
                s.descricao,
                s.andar_id,
                s.posicao_X,
                s.posicao_Y,
                a.nome AS andar,
                b.id AS bloco_id,
                b.nome AS bloco
            FROM salas s
            JOIN andares a ON a.id = s.andar_id
            JOIN blocos b ON b.id = a.bloco_id
            ORDER BY b.nome, a.nome, s.nome
        """).fetchall()

    return jsonify([dict(item) for item in registros])


@app.route("/api/salas", methods=["POST"])
def cadastrar_sala():
    dados = obter_dados()

    if dados is None:
        return erro("Envie os dados no formato JSON.")

    try:
        nome = texto_obrigatorio(dados, "nome")
        andar_id = inteiro_obrigatorio(dados, "andar_id")
        codigo = texto_opcional(dados, "codigo")
        descricao = texto_opcional(dados, "descricao")

        with conectar_banco() as conexao:
            andar = conexao.execute("""
                SELECT id FROM andares
                WHERE id = ?
            """, (andar_id,)).fetchone()

            if andar is None:
                return erro("Andar não encontrado.", 404)

            cursor = conexao.execute("""
                INSERT INTO salas (
                    andar_id, nome, codigo, descricao
                )
                VALUES (?, ?, ?, ?)
            """, (andar_id, nome, codigo, descricao))

            sala_id = cursor.lastrowid

        return jsonify({
            "mensagem": "Sala cadastrada com sucesso.",
            "id": sala_id,
            "nome": nome,
            "andar_id": andar_id
        }), 201

    except ValueError as exc:
        return erro(str(exc))
    except sqlite3.IntegrityError:
        return erro("Já existe uma sala com esse nome nesse andar.", 409)

@app.route("/api/salas/<int:sala_id>/posicao", methods=["PUT"])
def atualizar_posicao_sala(sala_id):
    dados = obter_dados()

    if dados is None:
        return erro("Envie os dados no formato JSON.")

    posicao_x = dados.get("posicao_x")
    posicao_y = dados.get("posicao_y")

    # Booleanos também são considerados números pelo Python,
    # por isso precisam ser rejeitados explicitamente.
    if (
        isinstance(posicao_x, bool)
        or not isinstance(posicao_x, (int, float))
        or isinstance(posicao_y, bool)
        or not isinstance(posicao_y, (int, float))
    ):
        return erro("As posições X e Y devem ser números.")

    import math

    if not math.isfinite(posicao_x) or not math.isfinite(posicao_y):
        return erro("As posições devem ser números finitos.")

    # As coordenadas serão percentuais dentro da planta: 0 a 100.
    if not (0 <= posicao_x <= 100 and 0 <= posicao_y <= 100):
        return erro("As posições devem estar entre 0 e 100.")

    with conectar_banco() as conexao:
        sala = conexao.execute(
            "SELECT id FROM salas WHERE id = ?",
            (sala_id,)
        ).fetchone()

        if sala is None:
            return erro("Sala não encontrada.", 404)

        conexao.execute(
            """
            UPDATE salas
            SET posicao_x = ?, posicao_y = ?
            WHERE id = ?
            """,
            (posicao_x, posicao_y, sala_id)
        )

    return jsonify({
        "mensagem": "Posição da sala atualizada com sucesso.",
        "sala_id": sala_id,
        "posicao_x": posicao_x,
        "posicao_y": posicao_y
    })

# -------------------------
# ATIVOS DE TI
# -------------------------

@app.route("/api/ativos", methods=["GET"])
def listar_ativos():
    with conectar_banco() as conexao:
        registros = conexao.execute("""
            SELECT
                a.id,
                a.patrimonio,
                a.numero_serie,
                a.nome,
                a.fabricante,
                a.modelo,
                a.endereco_ip,
                a.hostname,
                a.sistema_operacional,
                a.memoria_ram_gb,
                a.categoria_id,
                c.nome AS categoria,
                a.sala_id,
                s.nome AS sala,
                an.nome AS andar,
                b.nome AS bloco,
                a.status,
                a.observacoes,
                a.criado_em,
                a.atualizado_em
            FROM ativos a
            JOIN categorias c ON c.id = a.categoria_id
            LEFT JOIN salas s ON s.id = a.sala_id
            LEFT JOIN andares an ON an.id = s.andar_id
            LEFT JOIN blocos b ON b.id = an.bloco_id
            ORDER BY a.id DESC
        """).fetchall()

    return jsonify([dict(item) for item in registros])

@app.route("/api/ativos/exportar-xlsx", methods=["GET"])
def exportar_ativos_xlsx():
    # A autenticação é verificada pelo exigir_autenticacao().
    # Lê os mesmos tipos de filtros usados na interface.
    termo = request.args.get("busca", "").strip()
    categoria_id = request.args.get("categoria", "").strip()
    status = request.args.get("status", "").strip()
    bloco_id = request.args.get("bloco", "").strip()
    andar_id = request.args.get("andar", "").strip()
    sala_id = request.args.get("sala", "").strip()

    consulta = """
        SELECT
            a.id,
            a.patrimonio,
            a.numero_serie,
            a.nome,
            a.fabricante,
            a.modelo,
            a.endereco_ip,
            a.hostname,
            a.sistema_operacional,
            a.memoria_ram_gb,
            a.categoria_id,
            c.nome AS categoria,
            a.sala_id,
            s.nome AS sala,
            an.nome AS andar,
            b.nome AS bloco,
            a.status,
            a.observacoes,
            a.criado_em,
            a.atualizado_em
        FROM ativos a
        JOIN categorias c ON c.id = a.categoria_id
        LEFT JOIN salas s ON s.id = a.sala_id
        LEFT JOIN andares an ON an.id = s.andar_id
        LEFT JOIN blocos b ON b.id = an.bloco_id
        WHERE 1 = 1
    """

    parametros = []

    if termo:
        campos_busca = [
            "a.nome",
            "a.patrimonio",
            "a.numero_serie",
            "a.fabricante",
            "a.modelo",
            "a.hostname",
            "a.endereco_ip",
            "a.sistema_operacional",
            "a.memoria_ram_gb",
            "c.nome",
            "s.nome",
            "an.nome",
            "b.nome",
            "a.status",
            "a.observacoes",
        ]

        condicoes = [
            "LOWER(COALESCE(CAST("
            + campo
            + " AS TEXT), '')) LIKE LOWER(?)"
            for campo in campos_busca
        ]

        consulta += " AND (" + " OR ".join(condicoes) + ")"
        parametros.extend([f"%{termo}%"] * len(condicoes))

    if categoria_id:
        consulta += " AND a.categoria_id = ?"
        parametros.append(categoria_id)

    if status:
        consulta += " AND a.status = ?"
        parametros.append(status)

    if bloco_id:
        consulta += " AND b.id = ?"
        parametros.append(bloco_id)

    if andar_id:
        consulta += " AND an.id = ?"
        parametros.append(andar_id)

    if sala_id:
        consulta += " AND a.sala_id = ?"
        parametros.append(sala_id)

    consulta += " ORDER BY a.id DESC"

    with conectar_banco() as conexao:
        registros = conexao.execute(
            consulta,
            parametros
        ).fetchall()

    equipamentos = [dict(registro) for registro in registros]

    arquivo = criar_planilha_excel(equipamentos)

    return send_file(
        arquivo,
        as_attachment=True,
        download_name="inventario_ti.xlsx",
        mimetype=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
    )

@app.route("/api/ativos", methods=["POST"])
def cadastrar_ativo():
    dados = obter_dados()

    if dados is None:
        return erro("Envie os dados no formato JSON.")

    try:
        nome = texto_obrigatorio(dados, "nome")
        categoria_id = inteiro_obrigatorio(dados, "categoria_id")

        patrimonio = texto_opcional(dados, "patrimonio")
        numero_serie = texto_opcional(dados, "numero_serie")
        fabricante = texto_opcional(dados, "fabricante")
        modelo = texto_opcional(dados, "modelo")
        endereco_ip = validar_ip(texto_opcional(dados, "endereco_ip"))
        hostname = texto_opcional(dados, "hostname")
        sistema = texto_opcional(dados, "sistema_operacional")
        observacoes = texto_opcional(dados, "observacoes")

        sala_id = inteiro_opcional(dados, "sala_id")
        memoria = inteiro_opcional(dados, "memoria_ram_gb")

        status = dados.get("status", "Ativo")

        if not isinstance(status, str) or status not in STATUS_VALIDOS:
            raise ValueError("O status informado não é válido.")

        with conectar_banco() as conexao:
            categoria = conexao.execute("""
                SELECT id FROM categorias
                WHERE id = ?
            """, (categoria_id,)).fetchone()

            if categoria is None:
                return erro("Categoria não encontrada.", 404)

            if sala_id is not None:
                sala = conexao.execute("""
                    SELECT id FROM salas
                    WHERE id = ?
                """, (sala_id,)).fetchone()

                if sala is None:
                    return erro("Sala não encontrada.", 404)

            cursor = conexao.execute("""
                INSERT INTO ativos (
                    patrimonio,
                    numero_serie,
                    nome,
                    fabricante,
                    modelo,
                    endereco_ip,
                    hostname,
                    sistema_operacional,
                    memoria_ram_gb,
                    categoria_id,
                    sala_id,
                    status,
                    observacoes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                patrimonio,
                numero_serie,
                nome,
                fabricante,
                modelo,
                endereco_ip,
                hostname,
                sistema,
                memoria,
                categoria_id,
                sala_id,
                status,
                observacoes
            ))

            ativo_id = cursor.lastrowid

            if sala_id is not None:
                conexao.execute("""
                    INSERT INTO movimentacoes (
                        ativo_id,
                        sala_anterior_id,
                        sala_nova_id,
                        responsavel,
                        observacoes
                    )
                    VALUES (?, NULL, ?, ?, ?)
                """, (
                    ativo_id,
                    sala_id,
                    session["usuario"],
                    "Localização inicial registrada no cadastro"
                ))

        return jsonify({
            "mensagem": "Equipamento cadastrado com sucesso.",
            "id": ativo_id,
            "nome": nome,
            "patrimonio": patrimonio,
            "status": status
        }), 201

    except ValueError as exc:
        return erro(str(exc))
    except sqlite3.IntegrityError:
        return erro(
            "Não foi possível cadastrar. Verifique se o patrimônio já existe.",
            409
        )

@app.route("/api/ativos/<int:ativo_id>", methods=["PUT"])
def editar_ativo(ativo_id):
    dados = obter_dados()

    if dados is None:
        return erro("Envie os dados no formato JSON.")

    try:
        nome = texto_obrigatorio(dados, "nome")
        categoria_id = inteiro_obrigatorio(dados, "categoria_id")

        patrimonio = texto_opcional(dados, "patrimonio")
        numero_serie = texto_opcional(dados, "numero_serie")
        fabricante = texto_opcional(dados, "fabricante")
        modelo = texto_opcional(dados, "modelo")
        endereco_ip = validar_ip(
            texto_opcional(dados, "endereco_ip")
        )
        hostname = texto_opcional(dados, "hostname")
        sistema = texto_opcional(dados, "sistema_operacional")
        observacoes = texto_opcional(dados, "observacoes")

        sala_id = inteiro_opcional(dados, "sala_id")
        memoria = inteiro_opcional(dados, "memoria_ram_gb")

        status = dados.get("status", "Ativo")

        if not isinstance(status, str) or status not in STATUS_VALIDOS:
            raise ValueError("O status informado não é válido.")

        with conectar_banco() as conexao:
            atual = conexao.execute("""
                SELECT id, sala_id
                FROM ativos
                WHERE id = ?
            """, (ativo_id,)).fetchone()

            if atual is None:
                return erro("Equipamento não encontrado.", 404)

            categoria = conexao.execute("""
                SELECT id FROM categorias WHERE id = ?
            """, (categoria_id,)).fetchone()

            if categoria is None:
                return erro("Categoria não encontrada.", 404)

            if sala_id is not None:
                sala = conexao.execute("""
                    SELECT id FROM salas WHERE id = ?
                """, (sala_id,)).fetchone()

                if sala is None:
                    return erro("Sala não encontrada.", 404)

            sala_anterior_id = atual["sala_id"]

            conexao.execute("""
                UPDATE ativos
                SET
                    patrimonio = ?,
                    numero_serie = ?,
                    nome = ?,
                    fabricante = ?,
                    modelo = ?,
                    endereco_ip = ?,
                    hostname = ?,
                    sistema_operacional = ?,
                    memoria_ram_gb = ?,
                    categoria_id = ?,
                    sala_id = ?,
                    status = ?,
                    observacoes = ?,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                patrimonio,
                numero_serie,
                nome,
                fabricante,
                modelo,
                endereco_ip,
                hostname,
                sistema,
                memoria,
                categoria_id,
                sala_id,
                status,
                observacoes,
                ativo_id
            ))

            if sala_anterior_id != sala_id:
                conexao.execute("""
                    INSERT INTO movimentacoes (
                        ativo_id,
                        sala_anterior_id,
                        sala_nova_id,
                        responsavel,
                        observacoes
                    )
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    ativo_id,
                    sala_anterior_id,
                    sala_id,
                    session["usuario"],
                    texto_opcional(dados, "observacao_movimentacao")
                        or "Alteração de localização"
                ))

        return jsonify({
            "mensagem": "Equipamento atualizado com sucesso.",
            "id": ativo_id
        })

    except ValueError as exc:
        return erro(str(exc))
    except sqlite3.IntegrityError:
        return erro(
            "Não foi possível atualizar. Verifique se o patrimônio "
            "já pertence a outro equipamento.",
            409
        )

@app.route(
    "/api/ativos/<int:ativo_id>/movimentacoes",
    methods=["GET"]
)
def listar_movimentacoes(ativo_id):
    with conectar_banco() as conexao:
        ativo = conexao.execute("""
            SELECT id, nome, patrimonio
            FROM ativos
            WHERE id = ?
        """, (ativo_id,)).fetchone()

        if ativo is None:
            return erro("Equipamento não encontrado.", 404)

        registros = conexao.execute("""
            SELECT
                m.id,
                m.ativo_id,
                m.sala_anterior_id,
                m.sala_nova_id,
                m.data_movimentacao,
                m.responsavel,
                m.observacoes,
                sala_antiga.nome AS sala_anterior,
                andar_antigo.nome AS andar_anterior,
                bloco_antigo.nome AS bloco_anterior,
                sala_nova.nome AS sala_nova,
                andar_novo.nome AS andar_novo,
                bloco_novo.nome AS bloco_novo
            FROM movimentacoes m
            LEFT JOIN salas sala_antiga
                ON sala_antiga.id = m.sala_anterior_id
            LEFT JOIN andares andar_antigo
                ON andar_antigo.id = sala_antiga.andar_id
            LEFT JOIN blocos bloco_antigo
                ON bloco_antigo.id = andar_antigo.bloco_id
            LEFT JOIN salas sala_nova
                ON sala_nova.id = m.sala_nova_id
            LEFT JOIN andares andar_novo
                ON andar_novo.id = sala_nova.andar_id
            LEFT JOIN blocos bloco_novo
                ON bloco_novo.id = andar_novo.bloco_id
            WHERE m.ativo_id = ?
            ORDER BY m.id DESC
        """, (ativo_id,)).fetchall()

    return jsonify({
        "ativo": dict(ativo),
        "movimentacoes": [dict(item) for item in registros]
    })

if __name__ == "__main__":
    app.run(debug=True)
