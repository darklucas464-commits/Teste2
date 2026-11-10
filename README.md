# Lixeiro Pixel 3D

Jogo de lixeiro em **pixel art 3D**. O caminhão de lixo vai andando pela rua e você
corre atrás dele: pega o lixo da calçada e joga na caçamba para ganhar dinheiro.
Com o dinheiro você compra upgrades na loja.

## Como jogar

Abra o arquivo `index.html` no navegador (não precisa instalar nada).

| Ação | Computador | Celular |
| --- | --- | --- |
| Andar | `WASD` ou setas | Arrastar o dedo na tela |
| Jogar o lixo no caminhão | `Espaço` ou clique | Botão **JOGAR LIXO!** |
| Abrir a loja | `E` ou botão **LOJA** | Botão **LOJA** |
| Ligar/desligar o som | `M` ou botão **SOM** | Botão **SOM** |

- Encoste no lixo para pegar.
- Só dá para acertar a caçamba de dentro do círculo em volta da traseira do caminhão
  (verde = pode jogar, vermelho = longe demais).
- Jogar vários lixos seguidos aumenta o **combo** e cada lixo vale mais.
- A cada 20 lixos o caminhão compacta a carga e paga um **bônus**.
- O progresso é salvo sozinho no navegador.

## Lixos

| Lixo | Valor base |
| --- | --- |
| Saco preto | $1 |
| Saco azul | $2 |
| Caixa de papelão | $3 |
| Engradado de garrafas | $6 |
| TV velha | $15 |
| Saco dourado (raro!) | $60 |

## Upgrades

- **Tênis de corrida** – corre mais rápido
- **Braços fortes** – carrega mais lixo de uma vez
- **Arremesso forte** – joga de mais longe
- **Luva magnética** – pega o lixo de mais longe
- **Reciclagem** – cada lixo vale mais
- **Rota movimentada** – aparece mais lixo na rua
- **Bairro nobre** – aparece mais lixo raro e valioso
- **Ajudante** – um colega que cata e joga lixo sozinho (até 4)

## Arquivos

- `index.html` – página e interface
- `js/game.js` – todo o jogo
- `js/three.min.js` – [Three.js](https://threejs.org) r160 (licença MIT)
- `fonts/PressStart2P.woff2` – fonte Press Start 2P (licença SIL OFL)
