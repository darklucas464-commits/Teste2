# Estilhaço

Roguelike de sobrevivência em 3D que roda no navegador. Você controla só o movimento: as armas atacam sozinhas. Derrote hordas, junte cristais de XP e, a cada nível, escolha 1 entre 3 melhorias. Suba nas torres de pedra atrás dos baús e derrote o Colosso que desperta aos 4:00 para descer ao próximo andar.

## Como rodar

Abra `index.html` num navegador com acesso à internet. O three.js (r128) vem do cdnjs e as fontes vêm do Google Fonts. Não há etapa de build.

Para servir localmente:

```sh
python3 -m http.server 8000
# depois abra http://localhost:8000
```

## Controles

| Ação | Teclado e mouse | Toque |
|---|---|---|
| Andar | W A S D | Polegar esquerdo |
| Câmera | Mouse (clique para travar o cursor; arrastar também funciona), ← → | Arrastar no lado direito |
| Pular | Espaço (segure para planar com a Pena de Grifo) | Botão Pular |
| Deslizar | Shift ou Ctrl | Botão Deslizar |
| Abrir baú | E | Botão Abrir |
| Escolher melhoria | 1–4, R sorteia de novo | Tocar no cartão |
| Pausar | Esc ou P | Botão ❚❚ |

## O que tem no jogo

- **7 personagens**, cada um com bônus próprio e arma inicial. Libera com estilhaços.
- **7 armas** com 5 níveis: Lâminas Orbitais, Dardo Arcano, Arco Voltaico, Aura de Espinhos, Chuva de Meteoros, Bumerangue e Pisão Sísmico (dano por queda).
- **13 runas** de atributo com raridades (Comum, Rara, Épica e Lendária) e **20 relíquias** únicas que saem dos baús.
- **Mapas procedurais** em grade de colunas: mesas com escadas, colunas soltas e torres de saltos com baú no topo. Os inimigos andam por um campo de fluxo (BFS) que respeita os degraus.
- **5 tipos de inimigo**: Gosma, Diabrete, Morcego (voa), Olho (atira) e Bruto. Também há elites douradas que deixam baús grátis, enxames e o chefe Colosso de Lodo, que salta e solta ondas de choque.
- **Altares**: fique parado até encher para ganhar uma runa rara ou melhor.
- **4 biomas** em sequência: Bosque Suspenso, Dunas de Cobre, Geleira Partida e Abismo Violeta. A dificuldade cresce a cada andar.
- **Progressão permanente**: estilhaços, a Forja (8 melhorias) e 21 desafios. Tudo fica salvo no `localStorage` do navegador.
- Som e música sintetizados com Web Audio, sem arquivos de áudio.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Página de entrada |
| `style.css` | HUD, menus e layout para celular |
| `game.js` | Todo o jogo: geração de mapa, física, IA, armas, interface e salvamento |

`window.__estilhaco` expõe uma API pequena para testes automatizados. O `sim(segundos)` roda a partida sem desenhar, por exemplo.

## Sobre a originalidade

O jogo pertence ao gênero "sobrevivência com ataque automático em 3D", mas nome, personagens, itens, inimigos, arte e código são originais. Nenhum material de outro jogo foi usado.
