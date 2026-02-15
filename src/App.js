// src/App.js
import React, { useEffect, useRef, useState, useLayoutEffect} from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title", "Offer"],
  image: ["Image", "Credit Card Image", "Offer Image", "image", "Image URL"],
  link: ["Link", "Offer Link"],
  desc: ["Description", "Details", "Offer Description", "Flight Benefit"],

  // Permanent (inbuilt) CSV fields
  permanentCCName: ["Credit Card Name"],
  permanentBenefit: ["Movie Benefit", "Benefit", "Offer", "Hotel Benefit"],

  // ✅ NEW: UPI / NetBanking fields
  upi: ["UPI", "Upi", "UPI Options", "UPI Method"],
  netbanking: ["NetBanking", "Net Banking", "Netbanking", "NetBanking Options"],
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

/** -------------------- IMAGE FALLBACKS -------------------- */
const FALLBACK_IMAGE_BY_SITE = {
  bookmyshow:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxj6JoEII0Me05mN-I6RL0J-SkhbNSXNKN6g&s",
  pvr:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGdyL-nUMap7r9fqilEM0yeTX4SbArtP90Fg&s",
  cinepolis:
    "https://i.pinimg.com/564x/71/d5/af/71d5afb20fcf23f071a29c6162ced302.jpg",
  "paytm and district":
    "https://logos-world.net/wp-content/uploads/2020/11/Paytm-Logo.png",
};

function isUsableImage(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (/^(na|n\/a|null|undefined|-|image unavailable)$/i.test(s)) return false;
  return true;
}

/** Decide which image to show + whether it's a fallback (logo) */
function resolveImage(siteKey, candidate) {
  const key = String(siteKey || "").toLowerCase();
  const siteFallback = FALLBACK_IMAGE_BY_SITE[key];
  const fallback = siteFallback;
  const usingFallback = !isUsableImage(candidate) && !!fallback;
  return {
    src: usingFallback ? fallback : candidate,
    usingFallback,
  };
}

/** If the image fails, switch to fallback and mark as fallback for CSS */
function handleImgError(e, siteKey) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const el = e.currentTarget;
  if (fallback && el.src !== fallback) {
    el.src = fallback;
    el.classList.add("is-fallback");
  } else {
    el.style.display = "none"; // hide if even fallback fails
  }
}

/** -------------------- HELPERS -------------------- */
const toNorm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function firstField(obj, keys) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      String(obj[k]).trim() !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
}

/** case-insensitive find for keys that CONTAIN a substring */
function firstFieldByContains(obj, substr) {
  if (!obj) return undefined;
  const target = String(substr).toLowerCase();
  for (const k of Object.keys(obj)) {
    if (String(k).toLowerCase().includes(target)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

/** return all entries where predicate(key) is true */
function entriesWhereKey(obj, predicate) {
  if (!obj) return [];
  const out = [];
  for (const k of Object.keys(obj)) {
    if (predicate(String(k))) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        out.push({ key: k, value: v });
      }
    }
  }
  return out;
}

/** split across many separators */
function splitList(val) {
  if (!val) return [];
  return String(val)
    .split(/,|\/|;|\||\n|\r|\t|\band\b|\bAND\b|•/g)
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
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
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

  const matchingWords = qWords.filter((qw) =>
    cWords.some((cw) => cw.includes(qw))
  ).length;
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
  const imgGuess =
    firstField(offer, LIST_FIELDS.image) || firstFieldByContains(offer, "image");
  const image = normalizeUrl(imgGuess || "");
  const title = normalizeText(
    firstField(offer, LIST_FIELDS.title) || offer.Website || ""
  );
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

/** classification helpers */
const headerLooksDebit = (key) => {
  const k = String(key).toLowerCase();
  return /\bdebit\b/.test(k) && /\bcards?\b/.test(k);
};
const headerLooksCredit = (key) => {
  const k = String(key).toLowerCase();
  return /\bcredit\b/.test(k) && /\bcards?\b/.test(k);
};

function getRowTypeHint(row) {
  for (const k of Object.keys(row || {})) {
    const lk = k.toLowerCase();
    if (
      /\btype\b/.test(lk) ||
      /\bcard\s*type\b/.test(lk) ||
      /\bcategory\b/.test(lk) ||
      /\bsegment\b/.test(lk)
    ) {
      const v = String(row[k] || "").toLowerCase();
      if (/\bdebit\b/.test(v)) return "debit";
      if (/\bcredit\b/.test(v)) return "credit";
    }
  }
  return "";
}

function valueLooksDebit(s) {
  return /\bdebit\b/i.test(String(s || ""));
}
function valueLooksCredit(s) {
  return /\bcredit\b/i.test(String(s || ""));
}

/** 🔹 NEW: does the query contain a word similar to "select"? (handles "selct", "selet", etc.) */
function hasSelectLikeWord(text) {
  const qs = toNorm(text);
  if (!qs) return false;
  const words = qs.split(" ").filter(Boolean);
  for (const w of words) {
    if (w === "select") return true;
    // allow small typos: distance <= 2
    if (lev(w, "select") <= 2) return true;
  }
  return false;
}

/** ✅ Accessible marquee replacement (NO <marquee>, fixes ESLint) */


function MarqueeChipsRow({ label, items, type, onChipClick, title }) {
  const innerRef = useRef(null);
  const trackRef = useRef(null);
  const [durationSec, setDurationSec] = useState(30);

  // ✅ one global speed for ALL rows (px/sec)
  const PX_PER_SEC = 120; // lower = slower, higher = faster (pick what feels right)
  const MIN_SEC = 22;
  const MAX_SEC = 240;

  // measure after DOM layout so widths are correct
  useLayoutEffect(() => {
    if (!items || items.length === 0) return;

    const inner = innerRef.current;
    const track = trackRef.current;
    if (!inner && !track) return;

    const calc = () => {
      // movement distance is exactly 50% of inner width (because transform:-50%)
      const innerW = inner?.scrollWidth || 0;
      const distancePx = innerW ? innerW / 2 : (track?.scrollWidth || 0);

      if (!distancePx) return;

      const sec = distancePx / PX_PER_SEC;
      setDurationSec(Math.min(MAX_SEC, Math.max(MIN_SEC, Math.ceil(sec))));
    };

    const raf1 = requestAnimationFrame(() => {
      calc();
      // one more frame helps when fonts/images affect width
      requestAnimationFrame(calc);
    });

    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(calc);
      if (inner) ro.observe(inner);
      if (track) ro.observe(track);
    }

    window.addEventListener("resize", calc);

    // if browser supports it, recalc when fonts load too
    if (document.fonts?.ready) {
      document.fonts.ready.then(calc).catch(() => {});
    }

    return () => {
      cancelAnimationFrame(raf1);
      window.removeEventListener("resize", calc);
      if (ro) ro.disconnect();
    };
  }, [items]);

  if (!items || items.length === 0) return null;

  return (
    <div className="chipMarqueeRow" aria-label={label}>
      <strong className="chipMarqueeLabel">{label}:</strong>

      <div
        className="chipMarquee"
        style={{ "--marquee-duration": `${durationSec}s` }}
      >
        <div className="chipMarqueeInner" ref={innerRef}>
          {/* Track 1 */}
          <div className="chipMarqueeTrack" ref={trackRef}>
            {items.map((name, idx) => (
              <button
                key={`${type}-${idx}-${name}`}
                type="button"
                className="chipMarqueeChip"
                onClick={() => onChipClick(name, type)}
                title={title}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Track 2 (duplicate) */}
          <div className="chipMarqueeTrack" aria-hidden="true">
            {items.map((name, idx) => (
              <button
                key={`dup-${type}-${idx}-${name}`}
                type="button"
                className="chipMarqueeChip"
                onClick={() => onChipClick(name, type)}
                tabIndex={-1}
                title={title}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


/** Disclaimer */
const Disclaimer = () => (
  <section className="disclaimer">
    <h3>Disclaimer</h3>
    <p>
      All offers, coupons, and discounts listed on our platform are provided for
      informational purposes only. We do not guarantee the accuracy,
      availability, or validity of any offer. Users are advised to verify the
      terms and conditions with the respective merchants before making any
      purchase. We are not responsible for any discrepancies, expired offers, or
      losses arising from the use of these coupons.
    </p>
  </section>
);

/** -------------------- COMPONENT -------------------- */
const HotelOffers = () => {
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);
  // ✅ NEW
  const [upiEntries, setUpiEntries] = useState([]);
  const [netbankingEntries, setNetbankingEntries] = useState([]);

  const [marqueeCC, setMarqueeCC] = useState([]);
  const [marqueeDC, setMarqueeDC] = useState([]);
  // ✅ NEW
  const [marqueeUPI, setMarqueeUPI] = useState([]);
  const [marqueeNB, setMarqueeNB] = useState([]);

  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [bmsOffers, setBMSOffers] = useState([]);
  const [cinepolisOffers, setCinepolisOffers] = useState([]);
  const [paytmDistrictOffers, setPaytmDistrictOffers] = useState([]);
  const [pvrOffers, setPVROffers] = useState([]);
  const [permanentOffers, setPermanentOffers] = useState([]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`/allCards.csv`);
        const parsed = Papa.parse(res.data, { header: true });
        const rows = parsed.data || [];

        const creditMap = new Map();
        const debitMap = new Map();
        // ✅ NEW
        const upiMap = new Map();
        const nbMap = new Map();

        for (const row of rows) {
          const ccList = splitList(firstField(row, LIST_FIELDS.credit));
          for (const raw of ccList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
          }

          const dcList = splitList(firstField(row, LIST_FIELDS.debit));
          for (const raw of dcList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) debitMap.set(baseNorm, debitMap.get(baseNorm) || base);
          }

          // ✅ NEW: UPI + NetBanking from allCards.csv
          const upiList = splitList(firstField(row, LIST_FIELDS.upi));
          for (const raw of upiList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) upiMap.set(baseNorm, upiMap.get(baseNorm) || base);
          }

          const nbList = splitList(firstField(row, LIST_FIELDS.netbanking));
          for (const raw of nbList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) nbMap.set(baseNorm, nbMap.get(baseNorm) || base);
          }
        }

        const credit = Array.from(creditMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "credit"));
        const debit = Array.from(debitMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "debit"));

        // ✅ NEW
        const upi = Array.from(upiMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "upi"));
        const netbanking = Array.from(nbMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "netbanking"));

        setCreditEntries(credit);
        setDebitEntries(debit);
        // ✅ NEW
        setUpiEntries(upi);
        setNetbankingEntries(netbanking);

        setFilteredCards([
          ...(credit.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...credit,
          ...(debit.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...debit,
          ...(upi.length ? [{ type: "heading", label: "UPI" }] : []),
          ...upi,
          ...(netbanking.length ? [{ type: "heading", label: "NetBanking" }] : []),
          ...netbanking,
        ]);

        if (!credit.length && !debit.length && !upi.length && !netbanking.length) {
          setNoMatches(true);
          setSelected(null);
        }
      } catch (e) {
        console.debug("[HotelOffers] all_cards.csv load error:", e);
        setNoMatches(true);
        setSelected(null);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const specs = [
          { key: "BMS", name: "Bookmyshow.csv", setter: setBMSOffers },
          { key: "CINE", name: "cinepolis.csv", setter: setCinepolisOffers },
          { key: "PAYTM", name: "district_paytm.csv", setter: setPaytmDistrictOffers },
          { key: "PVR", name: "PVR.csv", setter: setPVROffers },
          { key: "PERM", name: "permanent_offers.csv", setter: setPermanentOffers },
        ];

        await Promise.all(
          specs.map(async (f) => {
            const res = await axios.get(`/${encodeURIComponent(f.name)}`);
            const parsed = Papa.parse(res.data, { header: true });
            const rows = parsed.data || [];
            f.setter(rows);
          })
        );
      } catch (e) {
        console.debug("[HotelOffers] Offer CSV load error:", e);
      }
    })();
  }, []);

  // ✅ NEW: Ensure dropdown has UPI/NetBanking entries even if allCards.csv doesn’t include them
  useEffect(() => {
    const upiMap = new Map();
    const nbMap = new Map();

    const harvest = (rows) => {
      for (const o of rows || []) {
        const upiField = firstField(o, LIST_FIELDS.upi) || firstFieldByContains(o, "upi");
        if (upiField) {
          for (const raw of splitList(upiField)) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) upiMap.set(baseNorm, upiMap.get(baseNorm) || base);
          }
        }

        const nbField =
          firstField(o, LIST_FIELDS.netbanking) ||
          firstFieldByContains(o, "netbank") ||
          firstFieldByContains(o, "net banking");
        if (nbField) {
          for (const raw of splitList(nbField)) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) nbMap.set(baseNorm, nbMap.get(baseNorm) || base);
          }
        }
      }
    };

    harvest(bmsOffers);
    harvest(cinepolisOffers);
    harvest(paytmDistrictOffers);
    harvest(pvrOffers);

    const upiFromOffers = Array.from(upiMap.values())
      .sort((a, b) => a.localeCompare(b))
      .map((d) => makeEntry(d, "upi"));

    const nbFromOffers = Array.from(nbMap.values())
      .sort((a, b) => a.localeCompare(b))
      .map((d) => makeEntry(d, "netbanking"));

    setUpiEntries((prev) => {
      const m = new Map();
      (prev || []).forEach((e) => e?.baseNorm && m.set(e.baseNorm, e));
      (upiFromOffers || []).forEach((e) => {
        if (e?.baseNorm && !m.has(e.baseNorm)) m.set(e.baseNorm, e);
      });
      return Array.from(m.values()).sort((a, b) => a.display.localeCompare(b.display));
    });

    setNetbankingEntries((prev) => {
      const m = new Map();
      (prev || []).forEach((e) => e?.baseNorm && m.set(e.baseNorm, e));
      (nbFromOffers || []).forEach((e) => {
        if (e?.baseNorm && !m.has(e.baseNorm)) m.set(e.baseNorm, e);
      });
      return Array.from(m.values()).sort((a, b) => a.display.localeCompare(b.display));
    });
  }, [bmsOffers, cinepolisOffers, paytmDistrictOffers, pvrOffers]);

  useEffect(() => {
    const ccMap = new Map();
    const dcMap = new Map();
    // ✅ NEW
    const upiMap = new Map();
    const nbMap = new Map();

    const harvestList = (val, targetMap) => {
      for (const raw of splitList(val)) {
        const base = brandCanonicalize(getBase(raw));
        const baseNorm = toNorm(base);
        if (baseNorm) targetMap.set(baseNorm, targetMap.get(baseNorm) || base);
      }
    };

    const harvestMixed = (val) => {
      for (const raw of splitList(val)) {
        const base = brandCanonicalize(getBase(raw));
        const baseNorm = toNorm(base);
        const lower = String(raw).toLowerCase();
        if (!baseNorm) continue;
        if (/\bdebit\b/.test(lower)) dcMap.set(baseNorm, dcMap.get(baseNorm) || base);
        else if (/\bcredit\b/.test(lower)) ccMap.set(baseNorm, ccMap.get(baseNorm) || base);
      }
    };

    const harvestByValueScan = (row) => {
      for (const v of Object.values(row || {})) {
        if (!v || typeof v !== "string") continue;
        const tokens = splitList(v).filter((t) => /\bcard\b/i.test(t));
        for (const tok of tokens) {
          const base = brandCanonicalize(getBase(tok));
          const baseNorm = toNorm(base);
          if (!baseNorm) continue;
          if (valueLooksDebit(tok)) dcMap.set(baseNorm, dcMap.get(baseNorm) || base);
          else if (valueLooksCredit(tok)) ccMap.set(baseNorm, ccMap.get(baseNorm) || base);
        }
      }
    };

    const harvestRows = (rows) => {
      for (const o of rows || []) {
        const debitHeaders = entriesWhereKey(o, (k) => {
          const lk = k.toLowerCase();
          return /\bdebit\b/.test(lk) && /\bcards?\b/.test(lk);
        });
        const creditHeaders = entriesWhereKey(o, (k) => {
          const lk = k.toLowerCase();
          return /\bcredit\b/.test(lk) && /\bcards?\b/.test(lk);
        });

        // ✅ NEW: UPI + NetBanking headers
        const upiHeaders = entriesWhereKey(o, (k) => /\bupi\b/i.test(k));
        const nbHeaders = entriesWhereKey(
          o,
          (k) => /\bnetbank\b/i.test(k) || /net\s*bank/i.test(k)
        );

        debitHeaders.forEach(({ value }) => harvestList(value, dcMap));
        creditHeaders.forEach(({ value }) => harvestList(value, ccMap));

        // ✅ NEW
        upiHeaders.forEach(({ value }) => harvestList(value, upiMap));
        nbHeaders.forEach(({ value }) => harvestList(value, nbMap));

        const mixedHeaders = entriesWhereKey(
          o,
          (k) => /\beligible\b/i.test(k) && /\bcards?\b/i.test(k)
        ).filter(({ key }) => !headerLooksDebit(key) && !headerLooksCredit(key));

        if (mixedHeaders.length) mixedHeaders.forEach(({ value }) => harvestMixed(value));

        if (!debitHeaders.length && !creditHeaders.length && !mixedHeaders.length) {
          harvestByValueScan(o);
        }
      }
    };

    harvestRows(bmsOffers);
    harvestRows(cinepolisOffers);
    harvestRows(paytmDistrictOffers);
    harvestRows(pvrOffers);

    for (const o of permanentOffers || []) {
      const nm =
        firstField(o, LIST_FIELDS.permanentCCName) ||
        firstFieldByContains(o, "credit card name");
      const base = brandCanonicalize(getBase(nm));
      const baseNorm = toNorm(base);
      if (baseNorm) ccMap.set(baseNorm, ccMap.get(baseNorm) || base);
    }

    const ccArr = Array.from(ccMap.values()).sort((a, b) => a.localeCompare(b));
    const dcArr = Array.from(dcMap.values()).sort((a, b) => a.localeCompare(b));
    // ✅ NEW
    const upiArr = Array.from(upiMap.values()).sort((a, b) => a.localeCompare(b));
    const nbArr = Array.from(nbMap.values()).sort((a, b) => a.localeCompare(b));

    setMarqueeCC(ccArr);
    setMarqueeDC(dcArr);
    // ✅ NEW
    setMarqueeUPI(upiArr);
    setMarqueeNB(nbArr);
  }, [bmsOffers, cinepolisOffers, paytmDistrictOffers, pvrOffers, permanentOffers]);

  /** 🔹 UPDATED: search box with fuzzy "select" handling + UPI/NetBanking */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);

    const trimmed = val.trim();
    if (!trimmed) {
      setFilteredCards([]);
      setSelected(null);
      setNoMatches(false);
      return;
    }

    const qLower = trimmed.toLowerCase();
    const qNorm = toNorm(trimmed);
    const queryHasSelectLike = hasSelectLikeWord(trimmed);

    const scored = (arr) =>
      (arr || [])
        .map((it) => {
          const s = scoreCandidate(trimmed, it.display);
          const labelNorm = toNorm(it.display);
          const inc = labelNorm.includes(qLower);

          // label has a real "select" word?
          const labelWords = labelNorm.split(" ").filter(Boolean);
          const labelHasSelectWord = labelWords.some(
            (w) => w === "select" || lev(w, "select") <= 1
          );

          const passesFuzzySelect = queryHasSelectLike && labelHasSelectWord;

          return { it, s, inc, passesFuzzySelect, labelNorm };
        })
        .filter(({ s, inc, passesFuzzySelect }) => inc || s > 0.3 || passesFuzzySelect)
        .sort((a, b) => b.s - a.s || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    // ✅ NEW: keyword detection for UPI / NetBanking
    const mentionsUPI = qNorm === "upi" || /\bupi\b/i.test(trimmed);
    const mentionsNetBanking =
      qNorm === "netbanking" ||
      qNorm === "net banking" ||
      /net\s*bank/i.test(trimmed);

    // If user types ONLY "upi" / "netbanking" -> show ALL of those entries
    const upiList =
      qNorm === "upi" ? (upiEntries || []).slice(0, MAX_SUGGESTIONS) : scored(upiEntries);
    const nbList =
      qNorm === "netbanking" || qNorm === "net banking"
        ? (netbankingEntries || []).slice(0, MAX_SUGGESTIONS)
        : scored(netbankingEntries);

    let cc = scored(creditEntries);
    let dc = scored(debitEntries);

    if (!cc.length && !dc.length && !upiList.length && !nbList.length) {
      setNoMatches(true);
      setSelected(null);
      setFilteredCards([]);
      return;
    }

    setNoMatches(false);

    // If query looks like "select" → push all "Select" cards to the top
    if (queryHasSelectLike) {
      const bumpSelectCards = (arr) => {
        const selectOnTop = [];
        const rest = [];
        arr.forEach((item) => {
          const norm = toNorm(item.display);
          const words = norm.split(" ").filter(Boolean);
          const hasSelectWord = words.some((w) => w === "select" || lev(w, "select") <= 1);
          if (hasSelectWord) selectOnTop.push(item);
          else rest.push(item);
        });
        return [...selectOnTop, ...rest];
      };
      cc = bumpSelectCards(cc);
      dc = bumpSelectCards(dc);
    }

    const buildList = (order) => {
      const out = [];
      for (const sec of order) {
        if (sec === "upi" && upiList.length) out.push({ type: "heading", label: "UPI" }, ...upiList);
        if (sec === "netbanking" && nbList.length)
          out.push({ type: "heading", label: "NetBanking" }, ...nbList);
        if (sec === "credit" && cc.length)
          out.push({ type: "heading", label: "Credit Cards" }, ...cc);
        if (sec === "debit" && dc.length)
          out.push({ type: "heading", label: "Debit Cards" }, ...dc);
      }
      return out;
    };

    // ✅ If query indicates NetBanking / UPI, show those sections at TOP
    if (mentionsNetBanking) {
      setFilteredCards(buildList(["netbanking", "upi", "credit", "debit"]));
      return;
    }
    if (mentionsUPI) {
      setFilteredCards(buildList(["upi", "netbanking", "credit", "debit"]));
      return;
    }

    // Default: Credit, Debit, UPI, NetBanking
    setFilteredCards(buildList(["credit", "debit", "upi", "netbanking"]));
  };

  const onPick = (entry) => {
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoMatches(false);
  };

  const handleChipClick = (name, type) => {
    const display = brandCanonicalize(getBase(name));
    const baseNorm = toNorm(display);
    setQuery(display);
    setSelected({ type, display, baseNorm });
    setFilteredCards([]);
    setNoMatches(false);
  };

  function matchesFor(offers, type, site) {
    if (!selected) return [];
    const out = [];
    for (const o of offers || []) {
      let list = [];
      if (type === "permanent") {
        const nm =
          firstField(o, LIST_FIELDS.permanentCCName) ||
          firstFieldByContains(o, "credit card name");
        if (nm) list = [nm];
      } else if (type === "upi") {
        const upi = firstField(o, LIST_FIELDS.upi) || firstFieldByContains(o, "upi");
        list = splitList(upi);
      } else if (type === "netbanking") {
        const nb =
          firstField(o, LIST_FIELDS.netbanking) ||
          firstFieldByContains(o, "netbank") ||
          firstFieldByContains(o, "net banking");
        list = splitList(nb);
      } else if (type === "debit") {
        const dcExplicit =
          firstField(o, LIST_FIELDS.debit) ||
          firstFieldByContains(o, "eligible debit") ||
          firstFieldByContains(o, "debit card");
        const dcFromHeaders = dcExplicit ? splitList(dcExplicit) : [];
        let dc = [...dcFromHeaders];

        if (!dc.length) {
          const typeHint = getRowTypeHint(o);
          const mixed =
            firstFieldByContains(o, "eligible cards") ||
            firstFieldByContains(o, "cards");
          if (mixed && typeHint === "debit") dc = splitList(mixed);
        }
        if (!dc.length) {
          const tokens = Object.values(o || {})
            .filter((v) => typeof v === "string")
            .flatMap((v) => splitList(v))
            .filter((t) => /\bdebit\b/i.test(t));
          dc = tokens;
        }
        list = dc;
      } else {
        const cc =
          firstField(o, LIST_FIELDS.credit) ||
          firstFieldByContains(o, "eligible credit") ||
          firstFieldByContains(o, "credit card") ||
          firstFieldByContains(o, "eligible cards");
        list = splitList(cc);
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
        out.push({ offer: o, site, variantText: matchedVariant, matchType: type });
      }
    }
    return out;
  }

  const selectedMatchType =
    selected?.type === "debit"
      ? "debit"
      : selected?.type === "upi"
      ? "upi"
      : selected?.type === "netbanking"
      ? "netbanking"
      : "credit";

  const wPermanent = matchesFor(permanentOffers, "permanent", "Permanent");
  const wBMS = matchesFor(bmsOffers, selectedMatchType, "Bookmyshow");
  const wCinepolis = matchesFor(cinepolisOffers, selectedMatchType, "Cinepolis");
  const wPaytmDistrict = matchesFor(
    paytmDistrictOffers,
    selectedMatchType,
    "Paytm and District"
  );
  const wPVR = matchesFor(pvrOffers, selectedMatchType, "PVR");

  const seen = new Set();
  const dPermanent = selected?.type === "credit" ? dedupWrappers(wPermanent, seen) : [];
  const dBMS = dedupWrappers(wBMS, seen);
  const dCinepolis = dedupWrappers(wCinepolis, seen);
  const dPaytmDistrict = dedupWrappers(wPaytmDistrict, seen);
  const dPVR = dedupWrappers(wPVR, seen);

  const hasAny = Boolean(
    dPermanent.length || dBMS.length || dCinepolis.length || dPaytmDistrict.length || dPVR.length
  );

  const sectionHeading = (siteLabel, defaultHeading) => {
    if (selected?.type === "upi") return `UPI offers on ${siteLabel}`;
    if (selected?.type === "netbanking") return `NetBanking offers on ${siteLabel}`;
    return defaultHeading;
  };

  const OfferCard = ({ wrapper, isPermanent = false }) => {
    const [copied, setCopied] = useState(false);
    const o = wrapper.offer;

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

    let image = firstField(o, LIST_FIELDS.image) || firstFieldByContains(o, "image");
    let title = isPermanent ? undefined : firstField(o, LIST_FIELDS.title) || o.Website;
    let desc = isPermanent ? firstField(o, LIST_FIELDS.permanentBenefit) : firstField(o, LIST_FIELDS.desc);
    let link = firstField(o, LIST_FIELDS.link);

    let couponCode;
    let terms;

    if (siteKey === "bookmyshow" || siteKey === "cinepolis") {
      title = getCI(o, "Offer") ?? title;
      desc = getCI(o, "Terms and Conditions") ?? desc;
      image = getCI(o, "Image") ?? image;
      link = getCI(o, "Link") ?? link;
    } else if (siteKey === "paytm and district") {
      couponCode = getCI(o, "Coupon Code");
      terms = getCI(o, "Terms and Conditions");
    } else if (siteKey === "pvr") {
      title = getCI(o, "Offer") ?? title;
      terms = getCI(o, "Terms and Conditions");
      link = getCI(o, "Link") ?? link;
      image = getCI(o, "Image") ?? image;
      if (terms) desc = terms;
    }

    const { src: imgSrc, usingFallback } = resolveImage(siteKey, image);

    const onCopy = () => {
      if (!couponCode) return;
      navigator.clipboard?.writeText(String(couponCode)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    };

    if (siteKey === "paytm and district") {
      return (
        <div className="offer-card">
          {imgSrc && (
            <img
              className={`offer-img ${usingFallback ? "is-fallback" : ""}`}
              src={imgSrc}
              alt="Offer"
              onError={(e) => handleImgError(e, siteKey)}
            />
          )}
          <div className="offer-info">
            {couponCode && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
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
                  type="button"
                >
                  <span role="img" aria-hidden="true">
                    📋
                  </span>{" "}
                  Copy
                </button>
                {copied && <span style={{ color: "#1e7145", fontSize: 14 }}>Copied!</span>}
              </div>
            )}

            {terms && (
              <div
                className="offer-desc"
                style={{
                  maxHeight: 140,
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
                <strong>Note:</strong> This benefit is applicable only on{" "}
                <em>{wrapper.variantText}</em> variant
              </p>
            )}

            {link && (
              <button className="btn" onClick={() => window.open(link, "_blank")} type="button">
                View Offer
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="offer-card">
        {imgSrc && (
          <img
            className={`offer-img ${usingFallback ? "is-fallback" : ""}`}
            src={imgSrc}
            alt="Offer"
            onError={(e) => handleImgError(e, siteKey)}
          />
        )}
        <div className="offer-info">
          {title && (
            <div className="offer-title" style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}>
              {title}
            </div>
          )}

          {desc && (
            <div
              className="offer-desc"
              style={
                SCROLL_SITES.has(wrapper.site)
                  ? {
                      maxHeight: 140,
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

          {isPermanent && (
            <p className="inbuilt-note" style={{ marginTop: 8 }}>
              <strong>This is a inbuilt feature of this credit card</strong>
            </p>
          )}

          {showVariantNote && (
            <p className="network-note" style={{ color: "#b00020", marginTop: 8 }}>
              <strong>Note:</strong> This benefit is applicable only on{" "}
              <em>{wrapper.variantText}</em> variant
            </p>
          )}

          {link && (
            <button className="btn" onClick={() => window.open(link, "_blank")} type="button">
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {(marqueeCC.length > 0 ||
        marqueeDC.length > 0 ||
        marqueeUPI.length > 0 ||
        marqueeNB.length > 0) && (
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
              justifyContent: "center",
              gap: 8,
              textAlign: "center",
            }}
          >
            <span>Credit, Debit, UPI And NetBanking Options Which Have Offers</span>
          </div>

          {/* ✅ REPLACED <marquee> with accessible CSS marquee */}
          <MarqueeChipsRow
            label="Credit Cards"
            items={marqueeCC}
            type="credit"
            onChipClick={handleChipClick}
            title="Click to select this card"
          />
          <MarqueeChipsRow
            label="Debit Cards"
            items={marqueeDC}
            type="debit"
            onChipClick={handleChipClick}
            title="Click to select this card"
          />
          <MarqueeChipsRow
            label="UPI"
            items={marqueeUPI}
            type="upi"
            onChipClick={handleChipClick}
            title="Click to select this UPI option"
          />
          <MarqueeChipsRow
            label="NetBanking"
            items={marqueeNB}
            type="netbanking"
            onChipClick={handleChipClick}
            title="Click to select this NetBanking option"
          />
        </div>
      )}

      {/* Search / dropdown */}
      <div
        className="dropdown"
        style={{
          position: "relative",
          width: isMobile ? "92%" : "600px",
          margin: "20px auto",
        }}
      >
        <input
          type="text"
          value={query}
          onChange={onChangeQuery}
          placeholder="Type a Credit / Debit / UPI / NetBanking option to check the offers...."
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
              border: "1px solid #ccc", // ✅ fixed no-useless-concat
              borderRadius: "6px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, idx) =>
              item.type === "heading" ? (
                <li
                  key={`h-${idx}`}
                  style={{ padding: "8px 10px", fontWeight: 700, background: "#fafafa" }}
                >
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

      {/* Offers by section */}
      {selected && hasAny && !noMatches && (
        <div className="offers-section" style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          {!!dBMS.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("Bookmyshow", "Offers on Bookmyshow")}
              </h2>
              <div className="offer-grid">
                {dBMS.map((w, i) => (
                  <OfferCard key={`bms-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dCinepolis.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("Cinepolis", "Offers on Cinepolis")}
              </h2>
              <div className="offer-grid">
                {dCinepolis.map((w, i) => (
                  <OfferCard key={`cine-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dPaytmDistrict.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("Paytm and District", "Offers on Paytm and District")}
              </h2>
              <div className="offer-grid">
                {dPaytmDistrict.map((w, i) => (
                  <OfferCard key={`pd-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dPVR.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("PVR and Inox", "Offers on PVR and Inox")}
              </h2>
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

      <Disclaimer />
    </div>
  );
};

export default HotelOffers;
