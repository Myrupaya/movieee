import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

// Fuzzy matching utility functions
const levenshteinDistance = (a, b) => {
  if (!a || !b) return 100;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i-1) === a.charAt(j-1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i-1][j] + 1,
        matrix[i][j-1] + 1,
        matrix[i-1][j-1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
};

const getMatchScore = (query, card) => {
  if (!query || !card) return 0;
  const qWords = query.trim().toLowerCase().split(/\s+/);
  const cWords = card.trim().toLowerCase().split(/\s+/);
  
  // Exact match bonus
  if (card.toLowerCase().includes(query.toLowerCase())) return 100;
  
  // Count how many query words appear in card
  const matchingWords = qWords.filter(qWord => 
    cWords.some(cWord => cWord.includes(qWord))
  ).length;
  
  // Calculate similarity score
  const similarity = 1 - (levenshteinDistance(query.toLowerCase(), card.toLowerCase()) / 
                         Math.max(query.length, card.length));
  
  return (matchingWords / qWords.length) * 0.7 + similarity * 0.3;
};

const highlightMatch = (text, query) => {
  if (!query.trim()) return text;
  
  const regex = new RegExp(`(${query.trim().split(/\s+/).map(word => 
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  
  return text.split(regex).map((part, i) => 
    regex.test(part) ? <mark key={i}>{part}</mark> : part
  );
};

const CreditCardDropdown = () => {
  const [creditCards, setCreditCards] = useState([]);
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [pvrOffers, setPvrOffers] = useState([]);
  const [bookMyShowOffers, setBookMyShowOffers] = useState([]);
  const [paytmDistrictOffers, setPaytmDistrictOffers] = useState([]);
  const [movieBenefits, setMovieBenefits] = useState([]);
  const [expandedOfferIndex, setExpandedOfferIndex] = useState({ pvr: null, bms: null, paytm: null });
  const [showNoCardMessage, setShowNoCardMessage] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert("Promo code copied: " + text);
    });
  };

  // Enhanced matching for network-specific cards
  const getOffersForSelectedCard = (offers) => {
    return offers.filter((offer) => {
      const offerCardName = offer["Credit Card Name"] ? offer["Credit Card Name"].trim() : "";
      
      // Direct match
      if (offerCardName.toLowerCase() === selectedCard.toLowerCase()) {
        return true;
      }
      
      // If selected card is a network variant, only match exact variants
      if (selectedCard.includes('(')) {
        return false;
      }
      
      // For base card, match base card and all its variants
      const baseCardName = selectedCard.replace(/\s*\([^)]*\)$/, '').trim();
      
      // Check if offer card name matches the base card
      if (offerCardName.toLowerCase() === baseCardName.toLowerCase()) {
        return true;
      }
      
      // Check if offer is for a network variant of the base card
      if (offerCardName.toLowerCase().startsWith(baseCardName.toLowerCase() + " ") &&
          offerCardName.includes('(')) {
        return true;
      }
      
      return false;
    });
  };

  const getMovieBenefitsForSelectedCard = () => {
    return movieBenefits.filter((offer) => {
      const offerCardName = offer["Credit Card Name"] ? offer["Credit Card Name"].trim() : "";
      
      // Direct match
      if (offerCardName.toLowerCase() === selectedCard.toLowerCase()) {
        return true;
      }
      
      // If selected card is a network variant, only match exact variants
      if (selectedCard.includes('(')) {
        return false;
      }
      
      // For base card, match base card and all its variants
      const baseCardName = selectedCard.replace(/\s*\([^)]*\)$/, '').trim();
      
      // Check if offer card name matches the base card
      if (offerCardName.toLowerCase() === baseCardName.toLowerCase()) {
        return true;
      }
      
      // Check if offer is for a network variant of the base card
      if (offerCardName.toLowerCase().startsWith(baseCardName.toLowerCase() + " ") &&
          offerCardName.includes('(')) {
        return true;
      }
      
      return false;
    });
  };

  const selectedPvrOffers = getOffersForSelectedCard(pvrOffers);
  const selectedBookMyShowOffers = getOffersForSelectedCard(bookMyShowOffers);
  const selectedPaytmDistrictOffers = getOffersForSelectedCard(paytmDistrictOffers);
  const selectedMovieBenefits = getMovieBenefitsForSelectedCard();

  const toggleOfferDetails = (type, index) => {
    setExpandedOfferIndex((prev) => ({
      ...prev,
      [type]: prev[type] === index ? null : index,
    }));
  };

  const hasAnyOffers = useCallback(() => {
    return (
      selectedPvrOffers.length > 0 ||
      selectedBookMyShowOffers.length > 0 ||
      selectedPaytmDistrictOffers.length > 0 ||
      selectedMovieBenefits.length > 0
    );
  }, [
    selectedPvrOffers,
    selectedBookMyShowOffers,
    selectedPaytmDistrictOffers,
    selectedMovieBenefits,
  ]);

  const handleScrollDown = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth"
    });
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const [pvrResponse, bmsResponse, paytmResponse, benefitsResponse] = await Promise.all([
          axios.get("/PVR.csv"),
          axios.get("/Bookmyshow.csv"),
          axios.get("/Paytm and District.csv"),
          axios.get("/Final_Movie_Benefits_List_With_Images.csv"),
        ]);

        const pvrData = Papa.parse(pvrResponse.data, { header: true });
        const bmsData = Papa.parse(bmsResponse.data, { header: true });
        const paytmData = Papa.parse(paytmResponse.data, { header: true });
        const benefitsData = Papa.parse(benefitsResponse.data, { header: true });

        setPvrOffers(pvrData.data);
        setBookMyShowOffers(bmsData.data);
        setPaytmDistrictOffers(paytmData.data);
        setMovieBenefits(benefitsData.data);

        const allCreditCards = new Set();
        
        pvrData.data.forEach(row => {
          if (row["Credit Card Name"]) allCreditCards.add(row["Credit Card Name"].trim());
        });
        
        bmsData.data.forEach(row => {
          if (row["Credit Card Name"]) allCreditCards.add(row["Credit Card Name"].trim());
        });
        
        paytmData.data.forEach(row => {
          if (row["Credit Card Name"]) allCreditCards.add(row["Credit Card Name"].trim());
        });
        
        benefitsData.data.forEach(row => {
          if (row["Credit Card Name"]) allCreditCards.add(row["Credit Card Name"].trim());
        });

        setCreditCards(Array.from(allCreditCards).sort());
      } catch (error) {
        console.error("Error loading CSV data:", error);
      }
    };

    fetchCSVData();
  }, []);

  useEffect(() => {
    setShowScrollButton(selectedCard && hasAnyOffers());
  }, [selectedCard, hasAnyOffers]);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQuery(value);
    setShowNoCardMessage(false);

    if (typingTimeout) clearTimeout(typingTimeout);

    if (!value) {
      setSelectedCard("");
      setFilteredCards([]);
      return;
    }

    // Filter and sort by match quality
    const scoredCards = creditCards.map(card => ({
      card,
      score: getMatchScore(value, card)
    }))
    .filter(item => item.score > 0.3) // Minimum match threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, 10); // Limit to top 10 results

    const combinedResults = [];
    if (scoredCards.length > 0) {
      combinedResults.push({ type: "heading", label: "Credit Cards" });
      combinedResults.push(...scoredCards.map(item => ({ 
        type: "credit", 
        card: item.card,
        score: item.score
      })));
    }

    setFilteredCards(combinedResults);

    if (combinedResults.length === 0 && value.length > 2) {
      const timeout = setTimeout(() => {
        setShowNoCardMessage(true);
      }, 1000);
      setTypingTimeout(timeout);
    }
  };

  const handleCardSelection = (card) => {
    setSelectedCard(card);
    setQuery(card);
    setFilteredCards([]);
    setExpandedOfferIndex({ pvr: null, bms: null, paytm: null });
    setShowNoCardMessage(false);
    if (typingTimeout) clearTimeout(typingTimeout);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="App">
      <div className="content-container">
        <div className="creditCardDropdown" style={{ position: "relative", width: "600px", margin: "2px auto", marginTop:"2px" }}>
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Type a Credit Card..."
            style={{
              width: "90%",
              padding: "12px",
              fontSize: "16px",
              border: `1px solid ${showNoCardMessage ? 'red' : '#ccc'}`,
              borderRadius: "5px",
            }}
          />
          {filteredCards.length > 0 && (
            <ul
              style={{
                listStyleType: "none",
                padding: "10px",
                margin: 0,
                width: "90%",
                maxHeight: "200px",
                overflowY: "auto",
                border: "1px solid #ccc",
                borderRadius: "5px",
                backgroundColor: "#fff",
                position: "absolute",
                zIndex: 1000,
              }}
            >
              {filteredCards.map((item, index) =>
                item.type === "heading" ? (
                  <li key={index} className="dropdown-heading">
                    <strong>{item.label}</strong>
                  </li>
                ) : (
                  <li
                    key={index}
                    onClick={() => handleCardSelection(item.card)}
                    style={{
                      padding: "10px",
                      cursor: "pointer",
                      borderBottom: index !== filteredCards.length - 1 ? "1px solid #eee" : "none",
                      backgroundColor: item.score > 0.8 ? "#f8fff0" : 
                                      item.score > 0.6 ? "#fff8e1" : "#fff"
                    }}
                    onMouseOver={(e) => (e.target.style.backgroundColor = "#f0f0f0")}
                    onMouseOut={(e) => (e.target.style.backgroundColor = 
                      item.score > 0.8 ? "#f8fff0" : 
                      item.score > 0.6 ? "#fff8e1" : "#fff")}
                  >
                    {highlightMatch(item.card, query)}
                    {item.score < 0.8 && (
                      <span style={{ 
                        float: "right", 
                        color: "#999", 
                        fontSize: "0.8em"
                      }}>
                        Similar
                      </span>
                    )}
                  </li>
                )
              )}
            </ul>
          )}
        </div>

        {showScrollButton && (
          <button 
            onClick={handleScrollDown}
            style={{
              position: "fixed",
              bottom: "350px",
              right: "20px",
              padding: isMobile ? "12px" : "10px 15px",
              backgroundColor: "#39641D",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: isMobile ? "40px" : "auto",
              height: isMobile ? "40px" : "auto"
            }}
            aria-label="Scroll down"
          >
            {isMobile ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            ) : (
              <span>Scroll Down</span>
            )}
          </button>
        )}

        {showNoCardMessage && (
          <div style={{ textAlign: "center", margin: "40px 0", fontSize: "20px", color: "red", fontWeight: "bold" }}>
            No offers for this card
          </div>
        )}

        {selectedCard && !hasAnyOffers() && !showNoCardMessage && (
          <div style={{ textAlign: "center", margin: "40px 0", fontSize: "20px", color: "#666" }}>
            No offers found for {selectedCard}
          </div>
        )}

        {selectedCard && hasAnyOffers() && (
          <div className="offer-section">
            {selectedMovieBenefits.length > 0 && (
              <div className="offer-container">
                <h2 style={{ margin: "20px 0" }}>Permanent Offers</h2>
                <div className="offer-row">
                  {selectedMovieBenefits.map((benefit, index) => (
                    <div key={`benefit-${index}`} className="offer-card" style={{backgroundColor: "#f5f5f5", color: "black", height:"auto", width:'1000px'}}>
                      {benefit.image && (
                        <img 
                          src={benefit.image} 
                          alt={benefit["Credit Card Name"] || "Card Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain",
                          }}
                        />
                      )}
                      
                      {benefit["Movie Benefit"] && <p><strong>Benefit:</strong> {benefit["Movie Benefit"]}</p>}
                      
                    </div>
                  ))}
                </div>
              </div>
            )}

{selectedPvrOffers.length > 0 && (
  <div className="offer-container">
    <h2>Offers on both PVR and INOX</h2>
    <div className="offer-row">
      {selectedPvrOffers.map((offer, index) => (
        <div 
          key={`pvr-${index}`} 
          className={`offer-card ${expandedOfferIndex.pvr === index ? 'expanded' : ''}`}
          style={{
            backgroundColor: "#f5f5f5", 
            color: "black",
            height: 'auto',
            overflow: 'hidden',
           width:'1000px'
          }}
        >
          {offer["Image URL"] && (
            <img 
              src={offer["Image URL"]} 
              alt={offer["Offer Title"] || "PVR Offer"} 
              style={{ 
                maxWidth: "100%", 
                height: "auto",
                maxHeight: "150px",
                objectFit: "contain"
              }} 
            />
          )}
          <h3>{offer["Offer Title"] || "PVR Offer"}</h3>
          {offer["Validity Date"] && <p><strong>Validity:</strong> {offer["Validity Date"]}</p>}
          {offer["Coupn Code"] && (
            <p>
              <span role="img" aria-label="important" style={{ marginRight: "5px" }}>⚠️</span>
              <strong>Important:</strong> {offer["Coupn Code"]}
            </p>
          )}
          
          <button 
            onClick={() => toggleOfferDetails("pvr", index)}
            className={`details-btn ${expandedOfferIndex.pvr === index ? "active" : ""}`}
            style={{ marginTop: '10px' }}
          >
            {expandedOfferIndex.pvr === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
          </button>
          
          {expandedOfferIndex.pvr === index && (
            <div className="terms-container">
              <div style={{
                maxHeight: '200px', 
                overflowY: 'auto',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginTop: '10px'
              }}>
                <p>{offer["Terms and Conditions"]}</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)}
            {selectedBookMyShowOffers.length > 0 && (
              <div className="offer-container">
                <h2>Offers on BookMyShow</h2>
                <div className="offer-row">
                  {selectedBookMyShowOffers.map((offer, index) => (
                    <div 
                      key={`bms-${index}`} 
                      className="offer-card"
                      style={{ backgroundColor: "#f5f5f5", color: "black", height:"auto" }}
                    >
                      {offer["Offer Image Link"] && (
                        <img 
                          src={offer["Offer Image Link"]} 
                          alt={"BookMyShow Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
            
                      {offer["Offer Description"] && <p><strong>Description:</strong> {offer["Offer Description"]}</p>}
                      {offer["Validity of Offer"] && <p><strong>Validity:</strong> {offer["Validity of Offer"]}</p>}
                      
                      {offer["Offer Link"] && (
                        <a 
                          href={offer["Offer Link"]} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          <button 
                            className="view-details-btn"
                            style={{ marginTop: '10px', cursor: 'pointer' }}
                          >
                            Click for more details
                          </button>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

{selectedPaytmDistrictOffers.length > 0 && (
  <div className="offer-container">
    <h2>Offers on Paytm and District</h2>
    <div className="offer-row">
      {selectedPaytmDistrictOffers.map((offer, index) => (
        <div 
          key={`paytm-${index}`} 
          className={`offer-card ${expandedOfferIndex.paytm === index ? 'expanded' : ''}`}
          style={{
            backgroundColor: "#f5f5f5", 
            color: "black",
            height: 'auto',
            overflow: 'hidden',
            width: '1000px'
          }}
        >
          {offer["Offer Image Link"] && (
            <img 
              src={offer["Offer Image Link"]} 
              alt={"Paytm & District Offer"} 
              style={{ 
                maxWidth: "100%", 
                height: "auto",
                maxHeight: "150px",
                objectFit: "contain"
              }} 
            />
          )}
          <h3>{offer["Offer title"] || "Paytm & District Offer"}</h3>
          {offer["Offer description"] && <p><strong>Description:</strong> {offer["Offer description"]}</p>}
          
          {offer["Promo code"] && (
            <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0' }}>
              <strong>Promo Code: </strong>
              <span style={{ 
                padding: '5px 10px', 
                backgroundColor: '#e9e9e9', 
                borderRadius: '4px',
                margin: '0 10px',
                fontFamily: 'monospace'
              }}>
                {offer["Promo code"]}
              </span>
              <div 
                onClick={() => copyToClipboard(offer["Promo code"])}
                style={{
                  padding: '6px',
                  backgroundColor: '#39641D',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Copy to clipboard"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </div>
            </div>
          )}
          
          <button 
            onClick={() => toggleOfferDetails("paytm", index)}
            className={`details-btn ${expandedOfferIndex.paytm === index ? "active" : ""}`}
            style={{ marginTop: '10px' }}
          >
            {expandedOfferIndex.paytm === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
          </button>
          
          {expandedOfferIndex.paytm === index && (
            <div className="terms-container">
              <div style={{
                maxHeight: '200px', 
                overflowY: 'auto',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginTop: '10px'
              }}>
                <p>{offer["Offer details"]}</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditCardDropdown;