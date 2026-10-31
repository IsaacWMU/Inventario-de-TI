import sqlite3
from pathlib import Path
from contextlib import contextmanager

CAMINHO_BANCO = Path(__file__).resolve().parent / "inventario.db"


@contextmanager
def conectar_banco():
    conexao = sqlite3.connect(CAMINHO_BANCO)
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA foreign_keys = ON")

    try:
        yield conexao
        conexao.commit()
    except Exception:
        conexao.rollback()
        raise
    finally:
        conexao.close()

def inicializar_banco():
    with conectar_banco() as conexao:
        conexao.executescript("""
            CREATE TABLE IF NOT EXISTS blocos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                descricao TEXT,
                ativo INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS andares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bloco_id INTEGER NOT NULL,
                nome TEXT NOT NULL,
                FOREIGN KEY (bloco_id)
                    REFERENCES blocos(id),
                UNIQUE (bloco_id, nome)
            );

            CREATE TABLE IF NOT EXISTS salas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                andar_id INTEGER NOT NULL,
                nome TEXT NOT NULL,
                codigo TEXT,
                descricao TEXT,
                FOREIGN KEY (andar_id)
                    REFERENCES andares(id),
                UNIQUE (andar_id, nome)
            );

            CREATE TABLE IF NOT EXISTS categorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS ativos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patrimonio TEXT UNIQUE,
                numero_serie TEXT,
                nome TEXT NOT NULL,
                fabricante TEXT,
                modelo TEXT,
                endereco_ip TEXT,
                hostname TEXT,
                sistema_operacional TEXT,
                memoria_ram_gb INTEGER,
                categoria_id INTEGER NOT NULL,
                sala_id INTEGER,
                status TEXT NOT NULL DEFAULT 'Ativo',
                observacoes TEXT,
                criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (categoria_id)
                    REFERENCES categorias(id),
                FOREIGN KEY (sala_id)
                    REFERENCES salas(id),
                CHECK (status IN (
                    'Ativo',
                    'Em manutenção',
                    'Inativo',
                    'Baixado'
                ))
            );

            CREATE TABLE IF NOT EXISTS movimentacoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ativo_id INTEGER NOT NULL,
                sala_anterior_id INTEGER,
                sala_nova_id INTEGER,
                data_movimentacao TEXT NOT NULL
                    DEFAULT CURRENT_TIMESTAMP,
                responsavel TEXT,
                observacoes TEXT,
                FOREIGN KEY (ativo_id)
                    REFERENCES ativos(id),
                FOREIGN KEY (sala_anterior_id)
                    REFERENCES salas(id),
                FOREIGN KEY (sala_nova_id)
                    REFERENCES salas(id)
            );

            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                usuario TEXT NOT NULL UNIQUE,
                senha_hash TEXT NOT NULL,
                perfil TEXT NOT NULL
                    CHECK (perfil IN ('admin', 'tecnico')),
                ativo INTEGER NOT NULL DEFAULT 1
                    CHECK (ativo IN (0, 1)),
                criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );            
        """)

        categorias = [
            "Computador",
            "Notebook",
            "Televisão",
            "Switch",
            "Impressora",
            "Nobreak",
            "Estabilizador",
            "Monitor",
            "Servidor",
            "Roteador",
            "Outro"
        ]

        conexao.executemany(
            "INSERT OR IGNORE INTO categorias (nome) VALUES (?)",
            [(categoria,) for categoria in categorias]
        )
