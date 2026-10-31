
from getpass import getpass

from werkzeug.security import generate_password_hash

from database import conectar_banco, inicializar_banco


def criar_admin():
    inicializar_banco()

    nome = input("Nome do administrador: ").strip()
    usuario = input("Nome de usuário para login: ").strip()

    if not nome or not usuario:
        print("Nome e usuário são obrigatórios.")
        return

    senha = getpass("Crie uma senha: ")
    confirmacao = getpass("Confirme a senha: ")

    if len(senha) < 12:
        print("Use uma senha com pelo menos 12 caracteres.")
        return

    if senha != confirmacao:
        print("As senhas não conferem.")
        return

    senha_hash = generate_password_hash(senha)

    try:
        with conectar_banco() as conexao:
            conexao.execute(
                """
                INSERT INTO usuarios
                    (nome, usuario, senha_hash, perfil)
                VALUES (?, ?, ?, 'admin')
                """,
                (nome, usuario, senha_hash)
            )

        print("Administrador criado com sucesso.")

    except Exception as erro:
        if "UNIQUE constraint failed" in str(erro):
            print("Esse nome de usuário já está cadastrado.")
        else:
            raise


if __name__ == "__main__":
    criar_admin()
