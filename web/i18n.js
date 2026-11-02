// Every text of the page, in English and in French.
//
// In the HTML, an element marked data-i18n="key" gets the text of that key;
// data-i18n-title, data-i18n-aria-label and data-i18n-placeholder fill those
// attributes; data-i18n-html fills the element with markup (only for texts of
// this file, never for anything typed by a user or sent by the server).
// In JavaScript, t("key", {name: value}) returns the text, with {name}
// replaced. A text can also be a function, for plurals.
//
// To add a language: copy the `en` block, translate it, add an <option>.

const TEXTS = {
  en: {
    // Page
    loadingSong: "Loading the song…",
    leftHand: "Left hand",
    rightHand: "Right hand",
    practice: "Practice",
    correctHands: "Correct hands",
    library: "Library",
    libraryCount: ({ count }) => `Library (${count})`,
    stageLabel: "The notes of the song fall towards the keyboard",
    transport: "Playback controls",
    back5: "Back 5 seconds",
    forward5: "Forward 5 seconds",
    play: "Play",
    pause: "Pause",
    position: "Position in the song",
    whatYouHear: "What you hear",
    fullSong: "Full song",
    pianoOnly: "Piano only",
    speed: "Speed",
    notes: "Notes",
    hidden: "Hidden",
    language: "Language",
    songDetails: ({ count, duration }) => `${count} notes, ${duration}`,
    noSongSelected: "No song selected",
    noSongYet: "No song yet",

    // Hand correction
    editHelp: "Click a tile to move it to the other hand. <kbd>Shift</kbd> + click: the whole chord. Mouse wheel: move through the song.",
    undo: "Undo",
    corrections: ({ count }) => (count === 0 ? "No correction" : count === 1 ? "1 note corrected" : `${count} notes corrected`),
    unsaved: "Unsaved changes…",
    saved: "Saved",
    saveFailed: "Saving failed. Try again.",

    // Practice
    hand: "Hand",
    bothHands: "Both",
    left: "Left",
    right: "Right",
    mic: "Mic",
    micLevel: "Microphone level",
    songSound: "Song sound",
    songSoundHint: "With headphones only: otherwise the microphone hears the song",
    skip: "Skip",
    skipHint: "Enter",
    loadingModel: "Loading the listening model…",
    micRefused: "Microphone refused. Allow it with the icon left of the address, then try again.",
    micFailed: ({ message }) => `Cannot listen to the microphone: ${message}`,
    practiceReady: "Ready. Press play: the song stops at every chord you have to play.",
    yourTurn: ({ notes }) => `Your turn: ${notes}`,
    wellPlayed: "Well played.",
    chordSkipped: "Chord skipped.",
    slowListening: ({ text, ms }) => `${text} (slow listening: ${ms} ms)`,
    score: ({ played, skipped }) => `${played} played · ${skipped} skipped`,

    // Library
    close: "Close",
    addSong: "Add a song",
    dropHint: "or drop an audio or video file anywhere on the page",
    fromLink: "From a link",
    add: "Add",
    dropOverlay: "Drop the file to add it to the library",
    statusQueued: "Waiting",
    statusDownloading: "Downloading…",
    statusProcessing: "Processing…",
    statusReady: "Ready",
    statusError: "Processing failed",
    addedOn: ({ date }) => `Added on ${date}`,
    delete: "Delete",
    confirm: "Confirm",
    deleteLabel: ({ title }) => `Delete ${title}`,
    confirmDeleteLabel: ({ title }) => `Confirm the deletion of ${title}`,
    songReady: ({ title }) => `“${title}” is ready. Click its title to play it.`,
    songFailed: ({ title, error }) => `Processing “${title}” failed: ${error}`,
    serverDown: "The server does not answer. Run “uv run piano-tiles-ai serve”, then reload the page.",
    cannotOpen: ({ title }) => `Cannot open “${title}”.`,
    sending: ({ name }) => `Sending “${name}”…`,
    sendingLink: "Sending the link…",
    nothingSent: "The server does not answer: nothing was sent.",
    invalidLink: "This link is not valid (it must start with https://).",
    sendFailed: ({ status }) => `Sending failed (error ${status}).`,
    alreadyThere: ({ title }) => `“${title}” was already in the library.`,
    linkReceived: "Link received: the sound will be downloaded, then processed. Allow two to three minutes.",
    processingSong: ({ title }) => `“${title}” is being processed. Allow one to two minutes.`,
    deleteFailed: "Deletion failed.",
    deleted: ({ title }) => `“${title}” was deleted.`,
  },

  fr: {
    loadingSong: "Chargement du morceau…",
    leftHand: "Main gauche",
    rightHand: "Main droite",
    practice: "S'entraîner",
    correctHands: "Corriger les mains",
    library: "Bibliothèque",
    libraryCount: ({ count }) => `Bibliothèque (${count})`,
    stageLabel: "Les notes du morceau tombent vers le clavier",
    transport: "Commandes de lecture",
    back5: "Reculer de 5 secondes",
    forward5: "Avancer de 5 secondes",
    play: "Lecture",
    pause: "Pause",
    position: "Position dans le morceau",
    whatYouHear: "Ce qu'on entend",
    fullSong: "Morceau",
    pianoOnly: "Piano seul",
    speed: "Vitesse",
    notes: "Notes",
    hidden: "Masquées",
    language: "Langue",
    songDetails: ({ count, duration }) => `${count} notes, ${duration}`,
    noSongSelected: "Aucun morceau sélectionné",
    noSongYet: "Aucun morceau pour l'instant",

    editHelp: "Cliquez une tuile pour la passer à l'autre main. <kbd>Maj</kbd> + clic&nbsp;: tout l'accord. Molette&nbsp;: avancer ou reculer.",
    undo: "Annuler",
    corrections: ({ count }) => (count === 0 ? "Aucune correction" : count === 1 ? "1 note corrigée" : `${count} notes corrigées`),
    unsaved: "Modifications non enregistrées…",
    saved: "Enregistré",
    saveFailed: "L'enregistrement a échoué. Réessayez.",

    hand: "Main",
    bothHands: "Les deux",
    left: "Gauche",
    right: "Droite",
    mic: "Micro",
    micLevel: "Niveau du micro",
    songSound: "Son du morceau",
    songSoundHint: "Avec un casque seulement : sinon le micro entend le morceau",
    skip: "Passer",
    skipHint: "Entrée",
    loadingModel: "Chargement du modèle d'écoute…",
    micRefused: "Micro refusé. Autorisez-le avec l'icône à gauche de l'adresse, puis réessayez.",
    micFailed: ({ message }) => `Impossible d'écouter le micro : ${message}`,
    practiceReady: "Prêt. Lancez la lecture : le morceau s'arrête à chaque accord à jouer.",
    yourTurn: ({ notes }) => `À vous : ${notes}`,
    wellPlayed: "Bien joué.",
    chordSkipped: "Accord passé.",
    slowListening: ({ text, ms }) => `${text} (écoute lente : ${ms} ms)`,
    score: ({ played, skipped }) => `${played} joué${played > 1 ? "s" : ""} · ${skipped} passé${skipped > 1 ? "s" : ""}`,

    close: "Fermer",
    addSong: "Ajouter un morceau",
    dropHint: "ou déposez un fichier audio ou vidéo n'importe où sur la page",
    fromLink: "Depuis un lien",
    add: "Ajouter",
    dropOverlay: "Déposez le fichier pour l'ajouter à la bibliothèque",
    statusQueued: "En attente",
    statusDownloading: "Téléchargement…",
    statusProcessing: "Traitement en cours…",
    statusReady: "Prêt",
    statusError: "Échec du traitement",
    addedOn: ({ date }) => `Ajouté le ${date}`,
    delete: "Supprimer",
    confirm: "Confirmer",
    deleteLabel: ({ title }) => `Supprimer ${title}`,
    confirmDeleteLabel: ({ title }) => `Confirmer la suppression de ${title}`,
    songReady: ({ title }) => `« ${title} » est prêt. Cliquez sur son titre pour le jouer.`,
    songFailed: ({ title, error }) => `Le traitement de « ${title} » a échoué : ${error}`,
    serverDown: "Le serveur ne répond pas. Lancez « uv run piano-tiles-ai serve », puis rechargez la page.",
    cannotOpen: ({ title }) => `Impossible d'ouvrir « ${title} ».`,
    sending: ({ name }) => `Envoi de « ${name} »…`,
    sendingLink: "Envoi du lien…",
    nothingSent: "Le serveur ne répond pas : rien n'a été envoyé.",
    invalidLink: "Ce lien n'est pas valide (il doit commencer par https://).",
    sendFailed: ({ status }) => `L'envoi a échoué (erreur ${status}).`,
    alreadyThere: ({ title }) => `« ${title} » était déjà dans la bibliothèque.`,
    linkReceived: "Lien reçu : le son va être téléchargé puis traité. Comptez deux à trois minutes.",
    processingSong: ({ title }) => `« ${title} » est en cours de traitement. Comptez une à deux minutes.`,
    deleteFailed: "La suppression a échoué.",
    deleted: ({ title }) => `« ${title} » a été supprimé.`,
  },
};

const LANGUAGES = Object.keys(TEXTS);
const LOCALES = { en: "en-US", fr: "fr-FR" }; // for dates and numbers

/** The saved language, or the browser's if it is one we have, or English. */
function initialLanguage() {
  try {
    const saved = localStorage.getItem("language");
    if (LANGUAGES.includes(saved)) return saved;
  } catch {
    // Storage blocked: fall back to the browser's language.
  }
  const browser = (navigator.language || "en").slice(0, 2);
  return LANGUAGES.includes(browser) ? browser : "en";
}

let currentLanguage = initialLanguage();

/** The text of a key in the current language (English if it is missing). */
function t(key, params = {}) {
  const text = TEXTS[currentLanguage][key] ?? TEXTS.en[key];
  if (text === undefined) {
    console.warn(`Missing text: ${key}`);
    return key;
  }
  return typeof text === "function" ? text(params) : text;
}

function locale() {
  return LOCALES[currentLanguage];
}

/** Fill every marked element of the page with the texts of the current language. */
function applyTranslations(root = document) {
  document.documentElement.lang = currentLanguage;
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll("[data-i18n-html]")) element.innerHTML = t(element.dataset.i18nHtml);
  for (const element of root.querySelectorAll("[data-i18n-title]")) element.title = t(element.dataset.i18nTitle);
  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
  for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
}

function setLanguage(language) {
  if (!LANGUAGES.includes(language)) return;
  currentLanguage = language;
  try {
    localStorage.setItem("language", language);
  } catch {
    // Not remembered: the browser's language will be used next time.
  }
  applyTranslations();
}
