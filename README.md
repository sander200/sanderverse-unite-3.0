# SANDERVERSE UNITE 3.0

MOBA HTML5 Canvas para GitHub Pages. Sem servidor.

## Modos

- **Solo** — você sozinho contra os 3 da outra facção + Némesis Omega
- **Eu + 2 bots** — você e 2 aliados contra os 3 inimigos + Omega

## Facções

- Base sul (azul): Sander · Cristian · Babalu
- Base norte (roxa): Polo · Lupe · Topete
- A facção segue o personagem que você escolhe

## Regras

- Partida de **5:00**, vitória aos **100 pontos**
- Pontua na **base contrária** (botão G / ANOTAR)
- Omega nasce no **Frenesí** (centro), é neutro
- Se o Omega te mata, ele rouba a aura, desce a pista e pontua contra o seu time
- Pílulas verdes recarregam HP; orbes cianos dão aura
- Nome + barra de vida em cima de cada um
- Câmera segue o jogador; minimapa com pontos em tempo real
- Palmeira, água, fonte e telão bloqueiam; só pista + escada
- Som leve o tempo todo; acelera no Frenesí (últimos 90 s)

## Controles

| Input | Ação |
| --- | --- |
| D-pad / analógico / WASD | Mover |
| ATACAR / Espaço | Golpe |
| 1 2 3 | Skills |
| G / ANOTAR | Depositar na base inimiga |

## GitHub Pages

Envie o conteúdo desta pasta para `main`.  
O workflow `.github/workflows/deploy-pages.yml` publica a cada push.  
Arquivo `.nojekyll` já vai junto.

```bash
python3 -m http.server 8080
```
