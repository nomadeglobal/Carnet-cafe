# ☕ Carnet Café

Catalogue personnel de cafés de spécialité — application web progressive (PWA)
installable sur Android, fonctionnant 100 % hors-ligne.

## Fonctionnalités

- **Fiche complète par café** : nom, pays d'origine, type/variété, provenance
  (région, ferme), altitude (MASL), traitement (lavé, naturel, co-fermenté…),
  arômes, torréfacteur, date de torréfaction, date d'achat, remarques de
  dégustation, note sur 5.
- **Photo du paquet** : prise directement avec l'appareil photo du téléphone
  (ou choisie dans la galerie), redimensionnée et stockée localement.
- **Tri** sur chaque champ et **filtres** par pays, traitement, torréfacteur, type.
- **Recherche** plein texte (nom, arômes, remarques…).
- **Tableau de bord** : podium des favoris, répartition par origine, note moyenne
  par pays, donut des traitements, torréfacteurs favoris, nuage d'arômes.
- **Import depuis le site du torréfacteur** : collez le lien de la page produit
  dans le formulaire et appuyez sur « Analyser » — origine, variété, traitement,
  arômes, torréfacteur et la fiche du lot (ferme, altitude…) sont extraits et
  remplis automatiquement (champs vides uniquement, toujours modifiables).
- **3 thèmes** au choix dans le menu ⚙ : Moka (sombre chaud), Lagon (clair bleu),
  Matcha (clair vert). Le choix est mémorisé.
- **Sauvegarde** : export / import JSON (photos incluses) depuis le menu ⚙.

Toutes les données restent sur l'appareil (IndexedDB) — rien n'est envoyé sur
un serveur. Seule exception : la fonction « Analyser » transmet l'adresse de la
page du torréfacteur à un service relais public (allorigins.win, corsproxy.io
ou r.jina.ai) pour pouvoir la lire — c'est nécessaire car les navigateurs
bloquent la lecture directe des autres sites (CORS).

## Installer sur votre téléphone Android

Une PWA doit être servie en HTTPS. Le plus simple :

### Option A — GitHub Pages (gratuit, recommandé)

1. Créez un dépôt sur [github.com](https://github.com) (par ex. `carnet-cafe`).
2. Déposez-y tous les fichiers de ce dossier (bouton *Add file → Upload files*).
3. Dans *Settings → Pages*, choisissez la branche `main` comme source.
4. Ouvrez l'URL fournie (`https://<votre-nom>.github.io/carnet-cafe/`) dans
   **Chrome sur votre téléphone**.
5. Menu ⋮ → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil »).

L'app apparaît alors avec son icône sur l'écran d'accueil, s'ouvre en plein
écran et fonctionne même sans connexion.

### Option B — Netlify Drop

Glissez-déposez simplement le dossier sur <https://app.netlify.com/drop>,
puis ouvrez l'URL générée sur votre téléphone et installez comme ci-dessus.

### Tester sur PC

```powershell
python -m http.server 8765
```

puis ouvrez <http://localhost:8765>.

## Notes techniques

- Aucune dépendance, aucun framework : HTML / CSS / JS vanilla.
- Stockage : IndexedDB (base `carnet-cafe`), photos en blobs JPEG (max 1280 px).
- Hors-ligne : service worker, stratégie « réseau d'abord, cache en secours »
  (les mises à jour de l'app sont donc récupérées automatiquement).
- Pensez à **exporter une sauvegarde** régulièrement (menu ⚙) : si vous
  désinstallez l'app ou effacez les données du site, le catalogue est perdu.
