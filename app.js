function lireConfig() {
  const noeud = document.getElementById("site-config");
  return JSON.parse(noeud.textContent);
}

function versInternational(affiche) {
  const chiffres = String(affiche).replace(/\D/g, "");
  if (chiffres.startsWith("33")) return chiffres;
  if (chiffres.startsWith("0")) return "33" + chiffres.slice(1);
  return chiffres;
}

function parseNombre(valeur) {
  if (typeof valeur !== "string") return Number.NaN;
  const propre = valeur.trim().replace(/\s/g, "").replace(",", ".");
  if (propre === "") return Number.NaN;
  return Number(propre);
}

function formatEuros(montant) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(montant);
}

function formatTarif(montant) {
  const entier = Math.abs(montant - Math.round(montant)) < 1e-9;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: entier ? 0 : 2,
    maximumFractionDigits: entier ? 0 : 2,
  }).format(montant);
}

function formatM2(valeur) {
  return (
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(valeur) +
    "\u00a0m²"
  );
}

function formatKm(valeur) {
  return (
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(valeur) +
    "\u00a0km"
  );
}

function aujourdhuiISO() {
  const date = new Date();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + mois + "-" + jour;
}

/**
 * Prix = forfait + surface × tarif/m² + distance × tarif/km.
 * Si le total est sous le minimum, le minimum est retenu.
 * Fourchette = base × (1 ± marge), arrondie à 10 €, plancher au minimum.
 */
function estimer(service, surface, km, bareme) {
  const poste = bareme[service];
  const partSurface = Math.round(surface * poste.euroParM2);
  const partTrajet = Math.round(km * poste.euroParKm);
  const forfait = Math.round(poste.forfait);
  const sousTotal = partSurface + partTrajet + forfait;
  const minimum = Math.round(poste.minimum);
  const base = Math.max(minimum, sousTotal);
  const marge = bareme.marge;
  let bas = Math.round((base * (1 - marge)) / 10) * 10;
  let haut = Math.round((base * (1 + marge)) / 10) * 10;
  if (bas < minimum) bas = minimum;
  if (haut < bas) haut = bas;
  return {
    partSurface,
    partTrajet,
    forfait,
    sousTotal,
    minimum,
    base,
    bas,
    haut,
    minimumApplique: minimum > sousTotal,
    euroParM2: poste.euroParM2,
    euroParKm: poste.euroParKm,
    marge,
  };
}

const SERVICES = {
  demenagement: {
    titre: "Déménagement simple",
    titrePieces: "Pièces à déménager",
    aidePieces: "Ajoutez chaque pièce du logement concernée. La surface indicative sert seulement à la fourchette.",
    pieces: [
      { id: "entree", label: "Entrée", m2: 5 },
      { id: "sejour", label: "Séjour", m2: 25 },
      { id: "cuisine", label: "Cuisine", m2: 12 },
      { id: "chambre", label: "Chambre", m2: 12 },
      { id: "bureau", label: "Bureau", m2: 10 },
      { id: "sdb", label: "Salle de bain", m2: 4 },
      { id: "dressing", label: "Dressing", m2: 6 },
      { id: "cave", label: "Cave ou garage", m2: 10 },
    ],
  },
  transport: {
    titre: "Transport de meuble",
    titrePieces: "Meubles à transporter",
    aidePieces: "Ajoutez chaque meuble. L’encombrement indicatif sert seulement à la fourchette.",
    pieces: [
      { id: "canape", label: "Canapé", m2: 2.5 },
      { id: "fauteuil", label: "Fauteuil", m2: 1 },
      { id: "lit", label: "Lit", m2: 3 },
      { id: "armoire", label: "Armoire", m2: 2 },
      { id: "table", label: "Table", m2: 2 },
      { id: "commode", label: "Commode", m2: 1.5 },
      { id: "electro", label: "Électroménager", m2: 1 },
      { id: "cartons", label: "Lot de cartons", m2: 1 },
    ],
  },
};

function selectionVide() {
  return {};
}

function surfaceDepuisSelection(service, quantites) {
  return SERVICES[service].pieces.reduce(function (total, piece) {
    return total + (quantites[piece.id] || 0) * piece.m2;
  }, 0);
}

function lignesSelection(service, quantites) {
  return SERVICES[service].pieces
    .filter(function (piece) { return (quantites[piece.id] || 0) > 0; })
    .map(function (piece) { return piece.label + " × " + quantites[piece.id]; });
}

function baremeExploitable(bareme) {
  if (!bareme || typeof bareme.marge !== "number") return false;
  return ["demenagement", "transport"].every(function (cle) {
    const poste = bareme[cle];
    if (!poste) return false;
    return ["forfait", "euroParM2", "euroParKm", "minimum"].every(function (champ) {
      return typeof poste[champ] === "number" && poste[champ] >= 0;
    });
  });
}

function init() {
  const config = lireConfig();
  if (!baremeExploitable(config.bareme)) {
    const alerte = document.getElementById("alerte");
    alerte.hidden = false;
    alerte.textContent = "Le barème du site est incomplet. Vérifiez la configuration.";
    return;
  }

  const etat = {
    etape: 0,
    service: null,
    quantites: selectionVide(),
    distanceSource: null,
  };
  let silenceKm = false;

  const form = document.getElementById("estimation");
  const alerte = document.getElementById("alerte");
  const annonce = document.getElementById("annonce");
  const listePieces = document.getElementById("liste-pieces");
  const kmInput = document.getElementById("km");
  const retour = document.getElementById("retour");
  const continuer = document.getElementById("continuer");

  appliquerIdentite(config);
  document.getElementById("date").min = aujourdhuiISO();
  document.getElementById("annee").textContent = String(new Date().getFullYear());

  document.querySelectorAll("[data-service]").forEach(function (bouton) {
    bouton.addEventListener("click", function () {
      choisirService(bouton.dataset.service);
    });
  });

  document.querySelectorAll("[data-ouvrir]").forEach(function (bouton) {
    bouton.addEventListener("click", function () {
      choisirService(bouton.dataset.ouvrir);
      allerEtape(1);
      document.getElementById("estimation").scrollIntoView();
    });
  });

  document.querySelectorAll("[data-aller]").forEach(function (bouton) {
    bouton.addEventListener("click", function () {
      const cible = Number(bouton.dataset.aller);
      if (cible < etat.etape) allerEtape(cible);
    });
  });

  listePieces.addEventListener("click", function (event) {
    const bouton = event.target.closest("[data-delta]");
    if (!bouton || !etat.service) return;
    const id = bouton.closest("[data-piece]").dataset.piece;
    const actuel = etat.quantites[id] || 0;
    const suivant = Math.max(0, Math.min(12, actuel + Number(bouton.dataset.delta)));
    if (suivant === 0) delete etat.quantites[id];
    else etat.quantites[id] = suivant;
    dessinerPieces();
    effacerAlerte();
  });

  kmInput.addEventListener("input", function () {
    if (silenceKm) return;
    etat.distanceSource = "saisie";
    document.getElementById("statut-trajet").textContent = "";
  });

  document.getElementById("calculer-km").addEventListener("click", calculerItineraire);
  document.getElementById("envoyer-email").addEventListener("click", envoyerEmail);
  document.getElementById("copier").addEventListener("click", copierRecap);
  document.getElementById("whatsapp").addEventListener("click", function (event) {
    if (!contactValide()) {
      event.preventDefault();
      return;
    }
    this.href = lienWhatsApp(config.telephoneAffiche, texteRecap());
  });

  retour.addEventListener("click", function () {
    if (etat.etape > 0) allerEtape(etat.etape - 1);
  });
  continuer.addEventListener("click", avancer);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (etat.etape < 3) avancer();
  });

  const entete = document.querySelector(".entete");
  document.addEventListener("scroll", function () {
    entete.classList.toggle("is-scrolled", window.scrollY > 8);
  }, { passive: true });

  afficherEtape();

  function choisirService(id) {
    etat.service = id;
    etat.quantites = selectionVide();
    document.querySelectorAll("[data-service]").forEach(function (bouton) {
      bouton.setAttribute("aria-pressed", String(bouton.dataset.service === id));
    });
    const meta = SERVICES[id];
    document.getElementById("titre-pieces").textContent = meta.titrePieces;
    document.getElementById("aide-pieces").textContent = meta.aidePieces;
    dessinerPieces();
    effacerAlerte();
  }

  function dessinerPieces() {
    const meta = SERVICES[etat.service];
    listePieces.replaceChildren();
    meta.pieces.forEach(function (piece) {
      const quantite = etat.quantites[piece.id] || 0;
      const item = document.createElement("li");
      item.className = "piece" + (quantite > 0 ? " est-choisie" : "");
      item.dataset.piece = piece.id;
      const texte = document.createElement("span");
      const nom = document.createElement("strong");
      nom.textContent = piece.label;
      const detail = document.createElement("small");
      detail.textContent = formatM2(piece.m2) + " indicatifs";
      texte.append(nom, detail);
      const pas = document.createElement("span");
      pas.className = "pas";
      pas.append(boutonPas("−", -1, "Retirer un " + piece.label), compteur(quantite), boutonPas("+", 1, "Ajouter un " + piece.label));
      item.append(texte, pas);
      listePieces.appendChild(item);
    });
    const lignes = lignesSelection(etat.service, etat.quantites);
    document.getElementById("resume-pieces").textContent = lignes.length
      ? lignes.join(", ") + " · " + formatM2(surfaceCourante()) + " au total."
      : "Aucune pièce sélectionnée.";
  }

  function boutonPas(symbole, delta, libelle) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.dataset.delta = String(delta);
    bouton.setAttribute("aria-label", libelle);
    bouton.textContent = symbole;
    return bouton;
  }

  function compteur(quantite) {
    const span = document.createElement("span");
    span.textContent = String(quantite);
    return span;
  }

  function surfaceCourante() {
    return surfaceDepuisSelection(etat.service, etat.quantites);
  }

  function kmCourants() {
    return parseNombre(kmInput.value);
  }

  function avancer() {
    const message = validationEtape();
    if (message) {
      montrerAlerte(message);
      return;
    }
    allerEtape(etat.etape + 1);
  }

  function validationEtape() {
    if (etat.etape === 0 && !etat.service) {
      return "Choisissez un déménagement simple ou un transport de meuble.";
    }
    if (etat.etape === 1 && lignesSelection(etat.service, etat.quantites).length === 0) {
      return "Choisissez au moins une pièce dans la liste.";
    }
    if (etat.etape === 2) {
      const km = kmCourants();
      if (!Number.isFinite(km) || km < 0 || km > 2500) {
        return "Indiquez une distance entre 0 et 2\u00a0500 km.";
      }
    }
    return "";
  }

  function allerEtape(indice) {
    etat.etape = indice;
    if (indice === 3) peindreResultat();
    afficherEtape();
    const panneau = form.querySelector('[data-step-panel="' + indice + '"]');
    const titre = panneau.querySelector("h2");
    titre.setAttribute("tabindex", "-1");
    titre.focus({ preventScroll: true });
  }

  function afficherEtape() {
    form.querySelectorAll("[data-step-panel]").forEach(function (panneau) {
      panneau.hidden = Number(panneau.dataset.stepPanel) !== etat.etape;
    });
    document.querySelectorAll("[data-aller]").forEach(function (bouton) {
      const indice = Number(bouton.dataset.aller);
      bouton.disabled = indice > etat.etape;
      if (indice === etat.etape) bouton.setAttribute("aria-current", "step");
      else bouton.removeAttribute("aria-current");
    });
    retour.hidden = etat.etape === 0;
    continuer.hidden = etat.etape === 3;
    continuer.textContent = etat.etape === 2 ? "Voir le devis" : "Continuer";
    const titres = ["Prestation", "Pièces", "Trajet", "Devis"];
    annonce.textContent = "Étape " + (etat.etape + 1) + " sur 4 : " + titres[etat.etape];
    effacerAlerte();
  }

  function peindreResultat() {
    const calcul = estimer(etat.service, surfaceCourante(), kmCourants(), config.bareme);
    const meta = SERVICES[etat.service];
    const margePourcent = Math.round(calcul.marge * 100);
    document.getElementById("prestation-retenue").textContent = meta.titre;
    document.getElementById("prix-bas").textContent = formatEuros(calcul.bas);
    document.getElementById("prix-haut").textContent = formatEuros(calcul.haut);
    document.getElementById("base-calcul").textContent =
      "Base retenue : " + formatEuros(calcul.base) + ". Fourchette de ±" + margePourcent + "\u00a0%, arrondie à 10\u00a0€.";

    const detail = document.getElementById("detail");
    detail.replaceChildren();
    ajouterLigne(detail, "Prise en charge", formatEuros(calcul.forfait));
    ajouterLigne(detail, lignesSelection(etat.service, etat.quantites).join(", "), "");
    ajouterLigne(
      detail,
      "Surface indicative · " + formatM2(surfaceCourante()) + " × " + formatTarif(calcul.euroParM2),
      formatEuros(calcul.partSurface)
    );
    ajouterLigne(
      detail,
      "Trajet · " + formatKm(kmCourants()) + " × " + formatTarif(calcul.euroParKm),
      formatEuros(calcul.partTrajet)
    );
    if (calcul.minimumApplique) {
      ajouterLigne(detail, "Minimum d’intervention retenu", formatEuros(calcul.minimum));
    }

    const notes = document.getElementById("notes");
    notes.replaceChildren();
    const depart = document.getElementById("depart").value.trim();
    const arrivee = document.getElementById("arrivee").value.trim();
    if (depart || arrivee) {
      ajouterNote(notes, "Trajet : " + (depart || "—") + " → " + (arrivee || "—") + ".");
    }
    if (etat.distanceSource === "itineraire") {
      ajouterNote(notes, "Distance proposée par un itinéraire routier OpenStreetMap, arrondie au kilomètre. Vous pouvez la corriger.");
    } else {
      ajouterNote(notes, "Distance indiquée par vous.");
    }
    if (kmCourants() >= 300) {
      ajouterNote(notes, "Longue distance : le déménageur confirmera péages et organisation du trajet.");
    }
    if (etat.service === "demenagement" && surfaceCourante() >= 180) {
      ajouterNote(notes, "Grande surface : le volume réel peut s’écarter de la surface du logement.");
    }
    ajouterNote(notes, "Les montants du détail sont arrondis à l’euro.");
    document.getElementById("statut-envoi").textContent = "";
  }

  function contactValide() {
    const nom = document.getElementById("nom").value.trim();
    const telephone = document.getElementById("telephone").value.replace(/\D/g, "");
    const email = document.getElementById("email").value.trim();
    if (nom.length < 2) {
      montrerAlerte("Indiquez votre nom.");
      document.getElementById("nom").focus();
      return false;
    }
    if (telephone.length < 10) {
      montrerAlerte("Indiquez un téléphone à 10 chiffres.");
      document.getElementById("telephone").focus();
      return false;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      montrerAlerte("L’e-mail semble incomplet.");
      document.getElementById("email").focus();
      return false;
    }
    effacerAlerte();
    return true;
  }

  function texteRecap() {
    const calcul = estimer(etat.service, surfaceCourante(), kmCourants(), config.bareme);
    const date = document.getElementById("date").value;
    const lignes = [
      "Demande de devis personnalisé — " + SERVICES[etat.service].titre,
      "Pièces : " + lignesSelection(etat.service, etat.quantites).join(", "),
      "Surface indicative : " + formatM2(surfaceCourante()),
      "Départ : " + (document.getElementById("depart").value.trim() || "non précisé"),
      "Arrivée : " + (document.getElementById("arrivee").value.trim() || "non précisée"),
      "Distance : " + formatKm(kmCourants()),
      "Fourchette indicative : " + formatEuros(calcul.bas) + " à " + formatEuros(calcul.haut),
      "Base de calcul : " + formatEuros(calcul.base),
      "Nom : " + document.getElementById("nom").value.trim(),
      "Téléphone : " + document.getElementById("telephone").value.trim(),
    ];
    const email = document.getElementById("email").value.trim();
    if (email) lignes.push("E-mail : " + email);
    if (date) lignes.push("Date souhaitée : " + date.split("-").reverse().join("/"));
    const message = document.getElementById("message").value.trim();
    if (message) lignes.push("Précisions : " + message);
    lignes.push("Estimation non contractuelle, à confirmer.");
    return lignes.join("\n");
  }

  function envoyerEmail() {
    if (!contactValide()) return;
    const sujet = "Devis personnalisé — " + SERVICES[etat.service].titre;
    const href = "mailto:" + config.email + "?subject=" + encodeURIComponent(sujet) + "&body=" + encodeURIComponent(texteRecap());
    document.getElementById("statut-envoi").textContent = "Votre application e-mail va s’ouvrir avec le récapitulatif.";
    window.location.href = href;
  }

  function copierRecap() {
    if (!contactValide()) return;
    const statut = document.getElementById("statut-envoi");
    navigator.clipboard.writeText(texteRecap()).then(function () {
      statut.textContent = "Récapitulatif copié. Vous pouvez le coller dans un message.";
    }, function () {
      statut.textContent = "La copie automatique a échoué. Envoyez la demande par e-mail ou par téléphone.";
    });
  }

  async function calculerItineraire() {
    const bouton = document.getElementById("calculer-km");
    const statut = document.getElementById("statut-trajet");
    const depart = document.getElementById("depart").value.trim();
    const arrivee = document.getElementById("arrivee").value.trim();
    if (!depart || !arrivee) {
      montrerAlerte("Indiquez une commune de départ et une commune d’arrivée.");
      return;
    }
    effacerAlerte();
    bouton.disabled = true;
    statut.textContent = "Calcul du trajet…";
    try {
      const pointDepart = await geocoder(depart);
      const pointArrivee = await geocoder(arrivee);
      const metres = await distanceMetres(pointDepart, pointArrivee);
      const km = kilometresArrondis(metres);
      silenceKm = true;
      kmInput.value = String(km);
      silenceKm = false;
      etat.distanceSource = "itineraire";
      statut.textContent = "Itinéraire routier : " + formatKm(km) + ". Vous pouvez corriger ce chiffre.";
    } catch (erreur) {
      const connu = erreur instanceof Error && /Commune|Itinéraire|kilomètres/.test(erreur.message);
      statut.textContent = connu
        ? erreur.message
        : "Itinéraire indisponible. Saisissez la distance en kilomètres.";
    } finally {
      bouton.disabled = false;
    }
  }
}

function ajouterLigne(detail, libelle, montant) {
  const terme = document.createElement("dt");
  terme.textContent = libelle;
  const valeur = document.createElement("dd");
  valeur.textContent = montant;
  detail.append(terme, valeur);
}

function ajouterNote(liste, texte) {
  const item = document.createElement("li");
  item.textContent = texte;
  liste.appendChild(item);
}

function lienWhatsApp(telephone, texte) {
  return "https://wa.me/" + versInternational(telephone) + "?text=" + encodeURIComponent(texte);
}

async function geocoder(requete) {
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(requete);
  const reponse = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!reponse.ok) throw new Error("Itinéraire indisponible. Saisissez la distance en kilomètres.");
  const lieux = await reponse.json();
  if (!lieux[0]) throw new Error("Commune introuvable. Vérifiez le nom, ou saisissez les kilomètres.");
  return { lat: lieux[0].lat, lon: lieux[0].lon };
}

async function distanceMetres(depart, arrivee) {
  const url = "https://router.project-osrm.org/route/v1/driving/" +
    depart.lon + "," + depart.lat + ";" + arrivee.lon + "," + arrivee.lat + "?overview=false";
  const reponse = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!reponse.ok) throw new Error("Itinéraire indisponible. Saisissez la distance en kilomètres.");
  const data = await reponse.json();
  if (!data.routes || !data.routes[0]) throw new Error("Itinéraire introuvable. Saisissez la distance en kilomètres.");
  return data.routes[0].distance;
}

function kilometresArrondis(metres) {
  const km = metres / 1000;
  if (km <= 0) return 0;
  if (km < 1) return 1;
  return Math.round(km);
}

function appliquerIdentite(config) {
  document.querySelectorAll(".js-nom").forEach(function (el) {
    el.textContent = config.nomComplet;
  });
  document.querySelectorAll(".js-activite").forEach(function (el) {
    el.textContent = config.activite;
  });
  document.querySelectorAll(".js-horaires").forEach(function (el) {
    el.textContent = config.horaires;
  });
  document.querySelectorAll(".js-adresse").forEach(function (el) {
    el.textContent = config.adresse;
  });
  document.querySelectorAll(".js-ville").forEach(function (el) {
    el.textContent = config.ville;
  });
  document.querySelectorAll(".js-siret").forEach(function (el) {
    el.textContent = config.siret;
  });
  document.title = config.nomComplet + " — Déménagement à Lyon";
  const tel = "tel:+" + versInternational(config.telephoneAffiche);
  document.querySelectorAll(".lien-tel").forEach(function (el) {
    el.textContent = config.telephoneAffiche;
    el.href = tel;
  });
  document.getElementById("appeler").href = tel;
  document.querySelectorAll(".lien-email").forEach(function (el) {
    el.textContent = config.email;
    el.href = "mailto:" + config.email;
  });
}

function montrerAlerte(message) {
  const alerte = document.getElementById("alerte");
  alerte.hidden = false;
  alerte.textContent = message;
}

function effacerAlerte() {
  const alerte = document.getElementById("alerte");
  alerte.hidden = true;
  alerte.textContent = "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { estimer, versInternational, parseNombre, kilometresArrondis, surfaceDepuisSelection, lignesSelection, SERVICES };
}

if (typeof document !== "undefined") {
  init();
}
