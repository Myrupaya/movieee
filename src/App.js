import React, { useEffect, useState } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- DEBUG -------------------- */
const DBG = true;
const dbg = (...args) => {
  if (DBG && typeof console !== "undefined") {
    console.log("[HotelOffers]", ...args);
  }
};

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title"],
  image: ["Image", "Credit Card Image", "Offer Image", "image", "Image URL"], // ✅ added "Image URL"
  link: ["Link", "Offer Link"],
  desc: ["Description", "Details", "Offer Description", "Flight Benefit"],
  // Permanent (inbuilt) CSV fields
  permanentCCName: ["Credit Card Name"],
  permanentBenefit: ["Movie Benefit", "Benefit", "Offer", "Hotel Benefit"],
};

const MAX_SUGGESTIONS = 50;

/** Sites that should display the red per-card “Applicable only on {variant} variant” note */
const VARIANT_NOTE_SITES = new Set([
  "Bookmyshow",
  "Cinepolis",
  "Paytm and District",
  "PVR",
  "Permanent",
]);

/** Sites whose description should be in a scrollable T&C-style box */
const SCROLL_SITES = new Set([
  "Bookmyshow",
  "Cinepolis",
  "Paytm and District",
  "PVR",
]);

/** -------------------- HELPERS -------------------- */
const toNorm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Trim BOM + NBSP + spaces */
const cleanKey = (s) => String(s || "").replace(/^\uFEFF/, "").trim();
const cleanCell = (s) =>
  String(s ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\u00A0/g, " ")
    .trim();

const normKey = (s) =>
  cleanKey(s)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Find a column in obj that matches any of the wanted keys (case/space/BOM-insensitive).
 *  If no exact normalized match, fall back to any column containing the word "debit" or "credit"
 */
function findKey(obj, wantedKeys) {
  if (!obj) return undefined;
  const rowKeys = Object.keys(obj);
  if (!rowKeys.length) return undefined;

  const wantedNorms = (wantedKeys || []).map(normKey);
  const rowMap = new Map(); // norm -> original
  for (const rk of rowKeys) rowMap.set(normKey(rk), rk);

  // 1) exact normalized match
  for (const w of wantedNorms) {
    if (rowMap.has(w)) {
      const match = rowMap.get(w);
      return match; // return even if empty; caller will decide
    }
  }

  // 2) fallback by keyword ("debit" / "credit")
  const wantDebit = wantedNorms.join(" ").includes("debit");
  const wantCredit = wantedNorms.join(" ").includes("credit");

  if (wantDebit || wantCredit) {
    for (const rk of rowKeys) {
      const nk = normKey(rk);
      if (wantDebit && nk.includes("debit")) {
        return rk;
      }
      if (wantCredit && nk.includes("credit")) {
        return rk;
      }
    }
  }

  return undefined;
}

/** Get the value using findKey */
function firstField(obj, keys) {
  const key = findKey(obj, keys);
  return key !== undefined ? obj[key] : undefined;
}

function splitList(val) {
  const v = cleanCell(val);
  if (!v) return [];
  return v
    .replace(/\n/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip trailing parentheses: "HDFC Regalia (Visa Signature)" -> "HDFC Regalia" */
function getBase(name) {
  if (!name) return "";
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Variant if present at end-in-parens: "… (Visa Signature)" -> "Visa Signature" */
function getVariant(name) {
  if (!name) return "";
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

/** Canonicalize some common brand spellings */
function brandCanonicalize(text) {
  let s = String(text || "");
  s = s.replace(/\bMakemytrip\b/gi, "MakeMyTrip");
  s = s.replace(/\bIcici\b/gi, "ICICI");
  s = s.replace(/\bHdfc\b/gi, "HDFC");
  s = s.replace(/\bSbi\b/gi, "SBI");
  s = s.replace(/\bIdfc\b/gi, "IDFC");
  s = s.replace(/\bPnb\b/gi, "PNB");
  s = s.replace(/\bRbl\b/gi, "RBL");
  s = s.replace(/\bYes\b/gi, "YES");
  return s;
}

/** Levenshtein distance */
function lev(a, b) {
  a = toNorm(a);
  b = toNorm(b);
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}

function scoreCandidate(q, cand) {
  const qs = toNorm(q);
  const cs = toNorm(cand);
  if (!qs) return 0;
  if (cs.includes(qs)) return 100;

  const qWords = qs.split(" ").filter(Boolean);
  const cWords = cs.split(" ").filter(Boolean);

  const matchingWords = qWords.filter((qw) => cWords.some((cw) => cw.includes(qw))).length;
  const sim = 1 - lev(qs, cs) / Math.max(qs.length, cs.length);
  return (matchingWords / Math.max(1, qWords.length)) * 0.7 + sim * 0.3;
}

/** Dropdown entry builder */
function makeEntry(raw, type) {
  const base = brandCanonicalize(getBase(raw));
  return { type, display: base, baseNorm: toNorm(base) };
}

function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) {
  return toNorm(s || "");
}
function offerKey(offer) {
  const image = normalizeUrl(firstField(offer, LIST_FIELDS.image) || "");
  const title = normalizeText(firstField(offer, LIST_FIELDS.title) || offer.Website || "");
  const desc = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}

function dedupWrappers(arr, seen) {
  const out = [];
  for (const w of arr || []) {
    const k = offerKey(w.offer);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** Disclaimer */
const Disclaimer = () => (
  <section className="disclaimer">
    <h3>Disclaimer</h3>
    <p>
      All offers, coupons, and discounts listed on our platform are provided for informational purposes only.
      We do not guarantee the accuracy, availability, or validity of any offer. Users are advised to verify the
      terms and conditions with the respective merchants before making any purchase. We are not responsible for any
      discrepancies, expired offers, or losses arising from the use of these coupons.
    </p>
  </section>
);

/** -------------------- COMPONENT -------------------- */
const HotelOffers = () => {
  // dropdown data (from all_cards.csv ONLY)
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  // marquee lists (from offer CSVs ONLY — NOT all_cards.csv)
  const [marqueeCC, setMarqueeCC] = useState([]);
  const [marqueeDC, setMarqueeDC] = useState([]);

  // ui state
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // offers (only these four + permanent)
  const [bmsOffers, setBMSOffers] = useState([]);                   // BookMyShow
  const [cinepolisOffers, setCinepolisOffers] = useState([]);       // Cinepolis
  const [paytmDistrictOffers, setPaytmDistrictOffers] = useState([]); // Paytm & District
  const [pvrOffers, setPVROffers] = useState([]);                   // PVR
  const [permanentOffers, setPermanentOffers] = useState([]);       // Permanent

  // responsive
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 1) Load all_cards.csv for dropdown lists ONLY
  useEffect(() => {
    async function loadAllCards() {
      try {
        dbg("Loading allCards.csv …");
        const res = await axios.get(`/allCards.csv`);
        const parsed = Papa.parse(res.data, { header: true });
        const rows = parsed.data || [];
        const headers = Object.keys(rows?.[0] || {});
        dbg("allCards.csv loaded", { rows: rows.length, headers });

        const creditMap = new Map();
        const debitMap = new Map();

        for (const row of rows) {
          const ccKey = findKey(row, LIST_FIELDS.credit);
          const dcKey = findKey(row, LIST_FIELDS.debit);

          if (!ccKey && !dcKey) {
            dbg("Row had no CC/DC fields match. Row keys:", Object.keys(row));
          }

          const ccList = splitList(ccKey ? row[ccKey] : undefined);
          const dcList = splitList(dcKey ? row[dcKey] : undefined);

          for (const raw of ccList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
          }
          for (const raw of dcList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) debitMap.set(baseNorm, debitMap.get(baseNorm) || base);
          }
        }

        const credit = Array.from(creditMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "credit"));
        const debit = Array.from(debitMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "debit"));

        dbg("Dropdown lists built", {
          creditCount: credit.length,
          debitCount: debit.length,
          creditSample: credit.slice(0, 5),
          debitSample: debit.slice(0, 5),
        });

        setCreditEntries(credit);
        setDebitEntries(debit);

        setFilteredCards([
          ...(credit.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...credit,
          ...(debit.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...debit,
        ]);

        if (!credit.length && !debit.length) {
          dbg("No credit or debit entries found in allCards.csv");
          setNoMatches(true);
          setSelected(null);
        }
      } catch (e) {
        console.error("all_cards.csv load error:", e);
        setNoMatches(true);
        setSelected(null);
      }
    }
    loadAllCards();
  }, []);

  // 2) Load ONLY the requested offer CSVs
  useEffect(() => {
    async function loadOffers() {
      try {
        const files = [
          { name: "bookmyshow.csv", setter: setBMSOffers, key: "BMS" },
          { name: "cinepolis.csv", setter: setCinepolisOffers, key: "CINE" },
          { name: "district_paytm.csv", setter: setPaytmDistrictOffers, key: "PAYTM" },
          { name: "pvr.csv", setter: setPVROffers, key: "PVR" },
          { name: "permanent_offers.csv", setter: setPermanentOffers, key: "PERM" },
        ];

        await Promise.all(
          files.map(async (f) => {
            dbg(`Loading ${f.name} …`);
            const res = await axios.get(`/${encodeURIComponent(f.name)}`);
            const parsed = Papa.parse(res.data, { header: true });
            const rows = parsed.data || [];
            const headers = Object.keys(rows?.[0] || {});
            dbg(`${f.name} loaded`, { key: f.key, rows: rows.length, headers });
            f.setter(rows);
          })
        );
      } catch (e) {
        console.error("Offer CSV load error:", e);
      }
    }
    loadOffers();
  }, []);

  /** Build marquee lists from OFFER CSVs (exclude allCards.csv) */
  useEffect(() => {
    const ccMap = new Map(); // baseNorm -> display
    const dcMap = new Map();

    // track which headers matched in each file
    const matchedCreditKeys = { BMS: new Set(), CINE: new Set(), PAYTM: new Set(), PVR: new Set() };
    const matchedDebitKeys  = { BMS: new Set(), CINE: new Set(), PAYTM: new Set(), PVR: new Set() };

    // sample harvested values for visibility
    const dcSamples = { BMS: [], CINE: [], PAYTM: [], PVR: [] };
    const ccSamples = { BMS: [], CINE: [], PAYTM: [], PVR: [] };

    const counters = {
      BMS: { creditRowsWithField: 0, debitRowsWithField: 0, rows: bmsOffers.length },
      CINE: { creditRowsWithField: 0, debitRowsWithField: 0, rows: cinepolisOffers.length },
      PAYTM: { creditRowsWithField: 0, debitRowsWithField: 0, rows: paytmDistrictOffers.length },
      PVR: { creditRowsWithField: 0, debitRowsWithField: 0, rows: pvrOffers.length },
      PERM: { ccNameRows: 0, rows: permanentOffers.length },
    };

    const harvestList = (val, targetMap, sampleArr) => {
      for (const raw of splitList(val)) {
        const base = brandCanonicalize(getBase(raw)); // strips "(Variant)"
        const baseNorm = toNorm(base);
        if (baseNorm) {
          targetMap.set(baseNorm, targetMap.get(baseNorm) || base);
          if (sampleArr && sampleArr.length < 5) sampleArr.push(base);
        }
      }
    };

    const harvestRows = (rows, tag) => {
      for (const o of rows || []) {
        const ccKey = findKey(o, LIST_FIELDS.credit);
        const dcKey = findKey(o, LIST_FIELDS.debit);

        if (ccKey) {
          counters[tag].creditRowsWithField++;
          matchedCreditKeys[tag].add(ccKey);
          harvestList(o[ccKey], ccMap, ccSamples[tag]);
        }
        if (dcKey) {
          counters[tag].debitRowsWithField++;
          matchedDebitKeys[tag].add(dcKey);
          harvestList(o[dcKey], dcMap, dcSamples[tag]);
        }
        if (!ccKey && !dcKey) {
          dbg(`${tag}: row had no CC/DC fields. Keys:`, Object.keys(o));
        }
      }
    };

    harvestRows(bmsOffers, "BMS");
    harvestRows(cinepolisOffers, "CINE");
    harvestRows(paytmDistrictOffers, "PAYTM");
    harvestRows(pvrOffers, "PVR");

    // Permanent offers: treat "Credit Card Name" as CC
    for (const o of permanentOffers || []) {
      const keyUsed = findKey(o, LIST_FIELDS.permanentCCName);
      if (keyUsed) {
        const nmRaw = o[keyUsed];
        const nm = cleanCell(nmRaw);
        if (nm) {
          counters.PERM.ccNameRows++;
          const base = brandCanonicalize(getBase(nm));
          const baseNorm = toNorm(base);
          if (baseNorm) ccMap.set(baseNorm, ccMap.get(baseNorm) || base);
        } else {
          dbg("PERM: empty Credit Card Name value. Keys:", Object.keys(o));
        }
      } else {
        dbg("PERM: row missing Credit Card Name. Keys:", Object.keys(o));
      }
    }

    const ccList = Array.from(ccMap.values()).sort((a, b) => a.localeCompare(b));
    const dcList = Array.from(dcMap.values()).sort((a, b) => a.localeCompare(b));
    setMarqueeCC(ccList);
    setMarqueeDC(dcList);

    dbg("Marquee build", {
      counters,
      matchedCreditKeys: {
        BMS: Array.from(matchedCreditKeys.BMS),
        CINE: Array.from(matchedCreditKeys.CINE),
        PAYTM: Array.from(matchedCreditKeys.PAYTM),
        PVR: Array.from(matchedCreditKeys.PVR),
      },
      matchedDebitKeys: {
        BMS: Array.from(matchedDebitKeys.BMS),
        CINE: Array.from(matchedDebitKeys.CINE),
        PAYTM: Array.from(matchedDebitKeys.PAYTM),
        PVR: Array.from(matchedDebitKeys.PVR),
      },
      ccSamples,
      dcSamples,
      marqueeCCCount: ccList.length,
      marqueeDCCount: dcList.length,
      marqueeCCSample: ccList.slice(0, 10),
      marqueeDCSample: dcList.slice(0, 10),
      LIST_FIELDS_debit: LIST_FIELDS.debit,
    });
  }, [bmsOffers, cinepolisOffers, paytmDistrictOffers, pvrOffers, permanentOffers]);

  /** search box */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (!val.trim()) {
      setFilteredCards([]);
      setSelected(null);
      setNoMatches(false);
      return;
    }

    const q = val.trim().toLowerCase();
    const scored = (arr) =>
      arr
        .map((it) => {
          const s = scoreCandidate(val, it.display);
          const inc = it.display.toLowerCase().includes(q);
          return { it, s, inc };
        })
        .filter(({ s, inc }) => inc || s > 0.3)
        .sort((a, b) => (b.s - a.s) || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    const cc = scored(creditEntries);
    const dc = scored(debitEntries);

    dbg("Search", {
      query: val,
      results: { cc: cc.length, dc: dc.length },
      ccSample: cc.slice(0, 3),
      dcSample: dc.slice(0, 3),
    });

    if (!cc.length && !dc.length) {
      setNoMatches(true);
      setSelected(null);
      setFilteredCards([]);
      return;
    }

    setNoMatches(false);
    setFilteredCards([
      ...(cc.length ? [{ type: "heading", label: "Credit Cards" }] : []),
      ...cc,
      ...(dc.length ? [{ type: "heading", label: "Debit Cards" }] : []),
      ...dc,
    ]);
  };

  const onPick = (entry) => {
    dbg("Picked entry", entry);
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoMatches(false);
  };

  // Click a chip → set the dropdown + selected entry
  const handleChipClick = (name, type) => {
    const display = brandCanonicalize(getBase(name));
    const baseNorm = toNorm(display);
    const entry = { type, display, baseNorm };
    dbg("Chip click → selecting", entry);
    setQuery(display);
    setSelected(entry);
    setFilteredCards([]);
    setNoMatches(false);
  };

  /** Build matches for one CSV: return wrappers {offer, site, variantText} */
  function matchesFor(offers, type, site) {
    if (!selected) return [];
    const out = [];
    let total = 0, hit = 0;

    for (const o of offers || []) {
      total++;
      let list = [];
      if (type === "permanent") {
        const nm = firstField(o, LIST_FIELDS.permanentCCName);
        if (nm) list = [nm]; // single card name
      } else if (type === "debit") {
        const key = findKey(o, LIST_FIELDS.debit);
        list = splitList(key ? o[key] : undefined);
      } else {
        const key = findKey(o, LIST_FIELDS.credit);
        list = splitList(key ? o[key] : undefined);
      }

      let matched = false;
      let matchedVariant = "";
      for (const raw of list) {
        const base = brandCanonicalize(getBase(raw));
        if (toNorm(base) === selected.baseNorm) {
          matched = true;
          const v = getVariant(raw);
          if (v) matchedVariant = v;
          break;
        }
      }
      if (matched) {
        hit++;
        out.push({ offer: o, site, variantText: matchedVariant });
      }
    }

    dbg("matchesFor", { site, type, totalRows: total, matchedRows: hit, selected: selected?.display });
    return out;
  }

  // Collect then global-dedup
  const wPermanent = matchesFor(permanentOffers, "permanent", "Permanent");
  const wBMS = matchesFor(bmsOffers, selected?.type === "debit" ? "debit" : "credit", "Bookmyshow");
  const wCinepolis = matchesFor(cinepolisOffers, selected?.type === "debit" ? "debit" : "credit", "Cinepolis");
  const wPaytmDistrict = matchesFor(paytmDistrictOffers, selected?.type === "debit" ? "debit" : "credit", "Paytm and District");
  const wPVR = matchesFor(pvrOffers, selected?.type === "debit" ? "debit" : "credit", "PVR");

  const seen = new Set();
  const dPermanent = dedupWrappers(wPermanent, seen);
  const dBMS = dedupWrappers(wBMS, seen);
  const dCinepolis = dedupWrappers(wCinepolis, seen);
  const dPaytmDistrict = dedupWrappers(wPaytmDistrict, seen);
  const dPVR = dedupWrappers(wPVR, seen);

  const hasAny = Boolean(
    dPermanent.length ||
    dBMS.length ||
    dCinepolis.length ||
    dPaytmDistrict.length ||
    dPVR.length
  );
  dbg("Offer presence", {
    hasAny,
    counts: {
      permanent: dPermanent.length,
      bms: dBMS.length,
      cinepolis: dCinepolis.length,
      paytm: dPaytmDistrict.length,
      pvr: dPVR.length,
    }
  });

  /** Offer card UI — hooks at top (no conditional hooks) */
  const OfferCard = ({ wrapper, isPermanent = false }) => {
    const [copied, setCopied] = useState(false); // used for Paytm & District only, safe at top

    const o = wrapper.offer;

    // case-insensitive getter for exact column names you specified
    const getCI = (obj, key) => {
      if (!obj) return undefined;
      const target = String(key).toLowerCase();
      for (const k of Object.keys(obj)) {
        if (String(k).toLowerCase() === target) return obj[k];
      }
      return undefined;
    };

    const siteKey = String(wrapper.site || "").toLowerCase();
    const showVariantNote =
      VARIANT_NOTE_SITES.has(wrapper.site) &&
      wrapper.variantText &&
      wrapper.variantText.trim().length > 0;

    const useScroll = SCROLL_SITES.has(wrapper.site);

    // Defaults (kept for other/legacy sites & permanent)
    let image = firstField(o, LIST_FIELDS.image);
    let title = isPermanent
      ? undefined
      : firstField(o, LIST_FIELDS.title) || o.Website;
    let desc = isPermanent
      ? firstField(o, LIST_FIELDS.permanentBenefit)
      : firstField(o, LIST_FIELDS.desc);
    let link = firstField(o, LIST_FIELDS.link);

    // Extra fields for specified sites
    let couponCode;
    let terms;

    // Apply your strict per-site fields
    if (siteKey === "bookmyshow" || siteKey === "cinepolis") {
      // fields: Offer, Offer Description, Images, Link
      title = getCI(o, "Offer") ?? title;
      desc  = getCI(o, "Offer Description") ?? desc;
      image = getCI(o, "Images") ?? image;
      link  = getCI(o, "Link") ?? link;
    } else if (siteKey === "paytm and district") {
      // fields: Coupon Code, Terms and conditions
      couponCode = getCI(o, "Coupon Code");
      terms      = getCI(o, "Terms and conditions");
    } else if (siteKey === "pvr") {
      // fields: Offer, Terms and conditions, Link, Image
      title = getCI(o, "Offer") ?? title;
      terms = getCI(o, "Terms and conditions");
      link  = getCI(o, "Link") ?? link;
      image = getCI(o, "Image") ?? image;
      if (terms) desc = terms; // show T&C as the description area (scrollable)
    }

    // One-time per-card debug
    dbg("OfferCard render", {
      site: wrapper.site,
      isPermanent,
      have: {
        image: !!image,
        title: !!title,
        desc: !!desc,
        link: !!link,
        couponCode: !!couponCode,
        terms: !!terms,
      },
    });

    const onCopy = () => {
      if (!couponCode) return;
      navigator.clipboard?.writeText(String(couponCode)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    };

    // Special rendering for Paytm & District (coupon + scrollable T&C)
    if (siteKey === "paytm and district") {
      return (
        <div className="offer-card">
          <div className="offer-info">
            {couponCode && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    padding: "6px 10px",
                    border: "1px dashed #9aa4b2",
                    borderRadius: 6,
                    background: "#f7f9ff",
                    fontFamily: "monospace",
                  }}
                >
                  {couponCode}
                </span>
                <button
                  className="btn"
                  onClick={onCopy}
                  aria-label="Copy coupon code"
                  title="Copy coupon code"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span role="img" aria-hidden="true">📋</span> Copy
                </button>
                {copied && (
                  <span style={{ color: "#1e7145", fontSize: 14 }}>Copied!</span>
                )}
              </div>
            )}

            {terms && (
              <div
                className="offer-desc"
                style={{
                  maxHeight: 140,   // T&C style scroll area
                  overflowY: "auto",
                  paddingRight: 8,
                  border: "1px solid #eee",
                  borderRadius: 6,
                  padding: "10px 12px",
                  background: "#fafafa",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {terms}
              </div>
            )}

            {showVariantNote && (
              <p className="network-note" style={{ color: "#b00020", marginTop: 8 }}>
                <strong>Note:</strong> This benefit is applicable only on <em>{wrapper.variantText}</em> variant
              </p>
            )}
          </div>
        </div>
      );
    }

    // Default rendering (BookMyShow, Cinepolis, PVR, Permanent, others)
    return (
      <div className="offer-card">
        {image && <img src={image} alt="Offer" />}
        <div className="offer-info">
          {/* Show the “offer” (title) when we have it */}
          {title && (
            <div
              className="offer-title"
              style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}
            >
              {title}
            </div>
          )}

          {desc && (
            <div
              className="offer-desc"
              style={
                useScroll
                  ? {
                      maxHeight: 140,   // T&C style scroll area
                      overflowY: "auto",
                      paddingRight: 8,
                      border: "1px solid #eee",
                      borderRadius: 6,
                      padding: "10px 12px",
                      background: "#fafafa",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }
                  : undefined
              }
            >
              {desc}
            </div>
          )}

          {/* ➕ Permanent-note line */}
          {isPermanent && (
            <p className="inbuilt-note" style={{ marginTop: 8 }}>
              <strong>This is a inbuilt feature of this credit card</strong>
            </p>
          )}

          {showVariantNote && (
            <p className="network-note" style={{ color: "#b00020", marginTop: 8 }}>
              <strong>Note:</strong> This benefit is applicable only on <em>{wrapper.variantText}</em> variant
            </p>
          )}

          {link && (
            <button className="btn" onClick={() => window.open(link, "_blank")}>
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>

      {/* 🔹 Cards-with-offers strip container */}
      {(marqueeCC.length > 0 || marqueeDC.length > 0) && (
        <div
          style={{
            maxWidth: 1200,
            margin: "14px auto 0",
            padding: "14px 16px",
            background: "#F7F9FC",
            border: "1px solid #E8EDF3",
            borderRadius: 10,
            boxShadow: "0 6px 18px rgba(15,23,42,.06)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color: "#1F2D45",
              marginBottom: 10,
              display: "flex",
              justifyContent:"center",
              gap: 8,
            }}
          >
            <span>Credit And Debit Cards Which Have Offers</span>
          </div>

          {/* CC marquee chips */}
          {marqueeCC.length > 0 && (
            <marquee direction="left" scrollAmount="4" style={{ marginBottom: 8, whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>Credit Cards:</strong>
              {marqueeCC.map((name, idx) => (
                <span
                  key={`cc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "credit")}
                  onKeyDown={(e) => (e.key === "Enter" ? handleChipClick(name, "credit") : null)}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}

          {/* DC marquee chips */}
          {marqueeDC.length > 0 && (
            <marquee direction="left" scrollAmount="4" style={{ whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>Debit Cards:</strong>
              {marqueeDC.map((name, idx) => (
                <span
                  key={`dc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "debit")}
                  onKeyDown={(e) => (e.key === "Enter" ? handleChipClick(name, "debit") : null)}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}
        </div>
      )}

      {/* Search / dropdown */}
      <div className="dropdown" style={{ position: "relative", width: "600px", margin: "20px auto" }}>
        <input
          type="text"
          value={query}
          onChange={onChangeQuery}
          placeholder="Type a Credit or Debit Card to check the offers...."
          className="dropdown-input"
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: `1px solid ${noMatches ? "#d32f2f" : "#ccc"}`,
            borderRadius: "6px",
          }}
        />
        {query.trim() && !!filteredCards.length && (
          <ul
            className="dropdown-list"
            style={{
              listStyle: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "260px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, idx) =>
              item.type === "heading" ? (
                <li key={`h-${idx}`} style={{ padding: "8px 10px", fontWeight: 700, background: "#fafafa" }}>
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${idx}-${item.display}`}
                  onClick={() => onPick(item)}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: "1px solid #f2f2f2",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f7f9ff")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {item.display}
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {noMatches && query.trim() && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 8 }}>
          No matching cards found. Please try a different name.
        </p>
      )}

      {/* Offers by section */}
      {selected && hasAny && !noMatches && (
        <div className="offers-section" style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          {!!dBMS.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Bookmyshow</h2>
              <div className="offer-grid">
                {dBMS.map((w, i) => (
                  <OfferCard key={`bms-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dCinepolis.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Cinepolis</h2>
              <div className="offer-grid">
                {dCinepolis.map((w, i) => (
                  <OfferCard key={`cine-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dPaytmDistrict.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Paytm and District</h2>
              <div className="offer-grid">
                {dPaytmDistrict.map((w, i) => (
                  <OfferCard key={`pd-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dPVR.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on PVR</h2>
              <div className="offer-grid">
                {dPVR.map((w, i) => (
                  <OfferCard key={`pvr-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dPermanent.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Permanent Offers</h2>
              <div className="offer-grid">
                {dPermanent.map((w, i) => (
                  <OfferCard key={`perm-${i}`} wrapper={w} isPermanent />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && !hasAny && !noMatches && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 10 }}>
          No offer available for this card
        </p>
      )}

      {selected && hasAny && !noMatches && (
        <button
          onClick={() => window.scrollBy({ top: window.innerHeight, behavior: "smooth" })}
          style={{
            position: "fixed",
            right: 20,
            bottom: isMobile ? 20 : 150,
            padding: isMobile ? "12px 15px" : "10px 20px",
            backgroundColor: "#1e7145",
            color: "white",
            border: "none",
            borderRadius: isMobile ? "50%" : 8,
            cursor: "pointer",
            fontSize: 18,
            zIndex: 1000,
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            width: isMobile ? 50 : 140,
            height: isMobile ? 50 : 50,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isMobile ? "↓" : "Scroll Down"}
        </button>
      )}

      <Disclaimer />
    </div>
  );
};

export default HotelOffers;
