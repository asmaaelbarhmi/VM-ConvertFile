/* Interface de conversion : 1 fichier → 2 réglages → 3 génération → 4 résultat */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var analyse = null; // réponse de /api/analyses
  var profils = null;
  var chronoDepart = 0;
  var chronoTimer = null;

  // --- Profils et état du moteur ---
  fetch("/api/sante").then(function (r) { return r.json(); }).then(function (s) {
    if (!s.moteur) { $("moteur-absent").hidden = false; }
  });
  fetch("/api/profils").then(function (r) { return r.json(); }).then(function (p) {
    profils = p;
    $("formats").textContent = "Formats : " + p.extensions.join(", ").toUpperCase() + " — " + p.taille_max_mo + " Mo max";
    remplir($("tissu"), p.tissus);
    remplir($("machine"), p.machines);
    var cartes = {};
    p.cartes_fils.forEach(function (c) { cartes[c] = { nom: c }; });
    remplir($("carte-fils"), cartes);
    majConseil();
  });
  function remplir(select, dico) {
    select.innerHTML = "";
    Object.keys(dico).forEach(function (cle) {
      var o = document.createElement("option");
      o.value = cle; o.textContent = dico[cle].nom;
      select.appendChild(o);
    });
  }
  function majConseil() {
    if (!profils) { return; }
    var t = profils.tissus[$("tissu").value];
    $("tissu-conseil").textContent = t ? t.conseil : "";
    verifierCadre();
  }
  function verifierCadre() {
    if (!profils || !analyse) { return; }
    var m = profils.machines[$("machine").value];
    var l = parseFloat($("largeur").value) || 0;
    var h = Math.round(l * analyse.hauteur_mm / analyse.largeur_mm * 10) / 10;
    var txt = "Hauteur : " + h + " mm (proportions conservées). ";
    txt += analyse.taille_connue ? "Taille lue dans le fichier." : "Taille par défaut : le fichier n'indique pas de dimensions.";
    if (m && (l > m.cadre_l_mm || h > m.cadre_h_mm)) {
      txt += " ⚠ Plus grand que le cadre " + m.cadre_l_mm + " × " + m.cadre_h_mm + " mm.";
    }
    $("taille-aide").textContent = txt;
  }
  $("tissu").addEventListener("change", majConseil);
  $("machine").addEventListener("change", verifierCadre);
  $("largeur").addEventListener("input", verifierCadre);

  // --- Étape 1 : dépôt du fichier ---
  var zone = $("zone-depot");
  ["dragenter", "dragover"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("survol"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("survol"); });
  });
  zone.addEventListener("drop", function (e) {
    if (e.dataTransfer.files.length) { analyser(e.dataTransfer.files[0]); }
  });
  $("fichier").addEventListener("change", function () {
    if (this.files.length) { analyser(this.files[0]); }
  });

  function analyser(fichier) {
    var donnees = new FormData();
    donnees.append("fichier", fichier);
    $("analyse-attente").hidden = false;
    $("etape-reglages").hidden = true;
    $("etape-resultat").hidden = true;
    fetch("/api/analyses", { method: "POST", body: donnees })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        $("analyse-attente").hidden = true;
        if (!res.ok) { alert(res.j.detail || "Fichier refusé."); return; }
        analyse = res.j;
        $("vignette").src = "/api/motifs/" + analyse.id + "/vignette.png";
        $("infos-fichier").textContent = analyse.format + " — " + analyse.pixels[0] + " × " + analyse.pixels[1] +
          " px, marges retirées — proposition : " + analyse.largeur_mm + " × " + analyse.hauteur_mm + " mm";
        $("largeur").value = analyse.largeur_mm;
        $("pastilles").innerHTML = analyse.couleurs.map(function (c) {
          return '<span class="pastille" style="background:' + c.hex + '" title="' + c.hex + " — " + Math.round(c.part * 100) + ' %"></span>';
        }).join("");
        $("nb-fils").textContent = analyse.couleurs.length + " fil(s) détecté(s) automatiquement";
        $("nb-couleurs").value = "";
        verifierCadre();
        $("etape-reglages").hidden = false;
      })
      .catch(function () { $("analyse-attente").hidden = true; alert("Le serveur ne répond pas."); });
  }

  // --- Étape 3 : génération ---
  $("form-reglages").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!analyse) { return; }
    var donnees = new FormData();
    donnees.append("largeur_mm", $("largeur").value);
    donnees.append("tissu", $("tissu").value);
    donnees.append("machine", $("machine").value);
    donnees.append("coupe_mm", $("coupe").value);
    donnees.append("carte_fils", $("carte-fils").value);
    var nb = $("nb-couleurs").value || analyse.couleurs.length;
    donnees.append("nb_couleurs", nb);
    var formats = ["dst"];
    document.querySelectorAll("input[name=format]:checked").forEach(function (c) { formats.push(c.value); });
    donnees.append("formats", formats.join(","));

    $("bouton-generer").disabled = true;
    $("etape-resultat").hidden = false;
    $("resultat").hidden = true;
    $("erreur").hidden = true;
    $("progression").hidden = false;
    chronoDepart = Date.now();
    chronoTimer = setInterval(function () {
      $("chrono").textContent = Math.round((Date.now() - chronoDepart) / 1000) + " s";
    }, 1000);
    fetch("/api/motifs/" + analyse.id, { method: "POST", body: donnees })
      .then(function (r) { return r.json(); })
      .then(function () { suivre(); })
      .catch(function () { montrerErreur("Le serveur ne répond pas."); });
  });

  function suivre() {
    fetch("/api/motifs/" + analyse.id).then(function (r) { return r.json(); }).then(function (etat) {
      if (etat.etat === "en_cours" || etat.etat === "analyse") { setTimeout(suivre, 1500); return; }
      if (etat.etat === "erreur") { montrerErreur(etat.erreur); return; }
      montrerResultat(etat);
    });
  }

  function finChrono() {
    clearInterval(chronoTimer);
    $("progression").hidden = true;
    $("bouton-generer").disabled = false;
  }

  function montrerErreur(message) {
    finChrono();
    $("erreur").textContent = message;
    $("erreur").hidden = false;
  }

  function montrerResultat(etat) {
    finChrono();
    var r = etat.rapport;
    $("resume").textContent = r.points + " points — " + r.largeur_mm + " × " + r.hauteur_mm + " mm — " +
      r.couleurs + " fil(s) — " + r.coupes + " coupes — ≈ " + Math.round(r.minutes) + " min sur " + etat.machine +
      " — tissu : " + etat.tissu + " — fils : " + etat.carte_fils;
    $("alertes").innerHTML = r.alertes.map(function (a) { return "<li>" + echapper(a) + "</li>"; }).join("");
    $("apercu").src = "/api/motifs/" + analyse.id + "/apercu.png?" + Date.now();
    $("ordre-fils").innerHTML = etat.fils.map(function (f) {
      var types = Object.keys(f.formes).map(function (t) { return f.formes[t] + " " + t; }).join(", ");
      return '<li><span class="pastille" style="background:' + f.hex + '"></span> Fil ' + f.fil + " — " + f.hex + " <small>(" + types + ")</small></li>";
    }).join("");
    var liens = etat.formats.map(function (f) {
      return '<a href="/api/motifs/' + analyse.id + "/motif." + f + '" download>Télécharger .' + f.toUpperCase() + "</a>";
    });
    liens.push('<a class="secondaire" href="/api/motifs/' + analyse.id + '/motif.svg" download>SVG Ink/Stitch (pour retouche)</a>');
    $("liens").innerHTML = liens.join("");
    $("resultat").hidden = false;
  }

  function echapper(t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
})();
