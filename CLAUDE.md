# obsidian-banner

Plugin Obsidian. **Le code vit ici, jamais dans le vault.**

| | |
|---|---|
| Dossier source | `code/jdr/obsidian-plugins/obsidian-banner/` |
| Branche de travail | `staging` |
| Identifiant du plugin | `obsidian-banner` |
| Cible de déploiement | `<vault>/.obsidian/plugins/obsidian-banner/` |

## Tester une modification

Build puis copie du résultat dans le vault :

```powershell
..\..\obsidian-plugin-tools\deploy-plugin.ps1 obsidian-banner     # Windows
```

```bash
../../obsidian-plugin-tools/deploy-plugin.sh obsidian-banner      # macOS
```

Puis dans Obsidian : `Ctrl+P` (`Cmd+P` sur Mac) et « Recharger l'application sans
sauvegarder ». Sans ce rechargement, Obsidian continue d'exécuter l'ancien `main.js`
et la modification semble sans effet.

## Règles

- **Ne jamais éditer les fichiers dans `.obsidian/plugins/obsidian-banner/`.** C'est une cible
  de déploiement : le contenu y est écrasé à chaque build et n'est versionné nulle part.
- **`data.json` appartient au vault.** C'est la configuration utilisateur du plugin,
  elle se synchronise entre les machines. Le script de déploiement n'y touche pas, et
  ce fichier n'a rien à faire dans ce dépôt.
- **`git pull` avant de commencer** si la session précédente s'est faite sur l'autre machine.
- **Builder depuis une seule machine à la fois.** Le `main.js` déployé se synchronise
  via Syncthing : deux builds concurrents produisent des fichiers `.sync-conflict`.
- **Pousser en fin de session.** Ce dépôt n'est couvert par aucune sauvegarde du vault,
  GitHub est le seul filet.

## Contexte

Le vault Obsidian est répliqué par Syncthing entre le PC fixe, un Mac, un Raspberry Pi
et un iPhone. Le 12/08/2026, une suppression propagée a vidé le vault et détruit les
dépôts git qui y vivaient. D'où cette séparation : le code dans git, seul le build dans
le vault. L'outillage de déploiement est dans
[obsidian-plugin-tools](https://github.com/hakimassouane2/obsidian-plugin-tools).
