import React, { useState, useEffect } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

const CreditCardDropdown = () => {
  const [creditCards, setCreditCards] = useState([]);
  const [debitCards, setDebitCards] = useState([]);
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [pvrOffers, setPvrOffers] = useState([]);
  const [inoxOffers, setInoxOffers] = useState([]);
  const [bookMyShowOffers, setBookMyShowOffers] = useState([]);
  const [movieDebitOffers, setMovieDebitOffers] = useState([]);
  const [movieBenefits, setMovieBenefits] = useState([]);
  const [expandedOfferIndex, setExpandedOfferIndex] = useState({ 
    pvr: null, 
    inox: null, 
    bms: null 
  });
  const [showNoCardMessage, setShowNoCardMessage] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState(null);

  const toggleOfferDetails = (type, index) => {
    setExpandedOfferIndex(prev => ({
      ...prev,
      [type]: prev[type] === index ? null : index
    }));
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const [pvrResponse, inoxResponse, bmsResponse, debitResponse, benefitsResponse] = await Promise.all([
          axios.get("/Pvr final.csv"),
          axios.get("/Inox final.csv"),
          axios.get("/Book My Show final.csv"),
          axios.get("/Final_Cleaned_Movie_Offers.csv"),
          axios.get("/Final_Movie_Benefits_List_With_Images.csv")
        ]);

        const pvrData = Papa.parse(pvrResponse.data, { header: true });
        const inoxData = Papa.parse(inoxResponse.data, { header: true });
        const bmsData = Papa.parse(bmsResponse.data, { header: true });
        const debitData = Papa.parse(debitResponse.data, { header: true });
        const benefitsData = Papa.parse(benefitsResponse.data, { header: true });

        setPvrOffers(pvrData.data);
        setInoxOffers(inoxData.data);
        setBookMyShowOffers(bmsData.data);
        setMovieDebitOffers(debitData.data);
        setMovieBenefits(benefitsData.data);

        const benefitsCreditCards = new Set();
        benefitsData.data.forEach(row => {
          if (row["Credit Card Name"]) {
            benefitsCreditCards.add(row["Credit Card Name"].trim());
          }
        });

        const otherCreditCards = new Set();
        
        pvrData.data.forEach(row => {
          if (row["Credit Card"]) {
            otherCreditCards.add(row["Credit Card"].trim());
          }
        });
        
        inoxData.data.forEach(row => {
          if (row["Credit Card"]) {
            otherCreditCards.add(row["Credit Card"].trim());
          }
        });
        
        bmsData.data.forEach(row => {
          if (row["Credit Card"]) {
            otherCreditCards.add(row["Credit Card"].trim());
          }
        });

        const allCreditCards = new Set([...benefitsCreditCards, ...otherCreditCards]);

        const allDebitCards = new Set();
        debitData.data.forEach(row => {
          if (row["Applicable Debit Cards"]) {
            row["Applicable Debit Cards"].split(",").forEach(card => {
              allDebitCards.add(card.trim());
            });
          }
        });

        setCreditCards(Array.from(allCreditCards).sort());
        setDebitCards(Array.from(allDebitCards).sort());
      } catch (error) {
        console.error("Error loading CSV data:", error);
      }
    };

    fetchCSVData();
  }, []);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQuery(value);
    setShowNoCardMessage(false);

    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    if (!value) {
      setSelectedCard("");
      setFilteredCards([]);
      return;
    }

    const queryWords = value.toLowerCase().split(/\s+/).filter(word => word.length > 0);
    
    const filteredCredit = creditCards.filter((card) => {
      const cardLower = card.toLowerCase();
      return queryWords.every(word => cardLower.includes(word));
    });
    
    const filteredDebit = debitCards.filter((card) => {
      const cardLower = card.toLowerCase();
      return queryWords.every(word => cardLower.includes(word));
    });

    const combinedResults = [];
    if (filteredCredit.length > 0) {
      combinedResults.push({ type: "heading", label: "Credit Cards" });
      combinedResults.push(...filteredCredit.map((card) => ({ type: "credit", card })));
    }
    if (filteredDebit.length > 0) {
      combinedResults.push({ type: "heading", label: "Debit Cards" });
      combinedResults.push(...filteredDebit.map((card) => ({ type: "debit", card })));
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
    setExpandedOfferIndex({ pvr: null, inox: null, bms: null });
    setShowNoCardMessage(false);
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
  };

  const getOffersForSelectedCard = (offers, isDebit = false) => {
    return offers.filter((offer) => {
      if (isDebit) {
        return (
          offer["Applicable Debit Cards"] &&
          offer["Applicable Debit Cards"].split(",").map((c) => c.trim()).includes(selectedCard)
        );
      } else {
        return offer["Credit Card"] && offer["Credit Card"].trim() === selectedCard;
      }
    });
  };

  const getMovieBenefitsForSelectedCard = () => {
    return movieBenefits.filter(offer => {
      const cardName = offer["Credit Card Name"] ? offer["Credit Card Name"].trim() : "";
      return cardName.toLowerCase() === selectedCard.toLowerCase();
    });
  };

  const selectedPvrOffers = getOffersForSelectedCard(pvrOffers);
  const selectedInoxOffers = getOffersForSelectedCard(inoxOffers);
  const selectedBookMyShowOffers = getOffersForSelectedCard(bookMyShowOffers);
  const selectedMovieDebitOffers = getOffersForSelectedCard(movieDebitOffers, true);
  const selectedMovieBenefits = getMovieBenefitsForSelectedCard();

  const hasAnyOffers = () => {
    return (
      selectedPvrOffers.length > 0 ||
      selectedInoxOffers.length > 0 ||
      selectedBookMyShowOffers.length > 0 ||
      selectedMovieDebitOffers.length > 0 ||
      selectedMovieBenefits.length > 0
    );
  };

  return (
    <div className="App">
      <nav className="navbar">
        <div className="logoContainer">
          <a href="https://www.myrupaya.in/">
            <img
              src="https://static.wixstatic.com/media/f836e8_26da4bf726c3475eabd6578d7546c3b2~mv2.jpg/v1/crop/x_124,y_0,w_3152,h_1458/fill/w_909,h_420,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/dark_logo_white_background.jpg"
              alt="MyRupaya Logo"
              className="logo"
            />
          </a>
          <div className="linksContainer">
            <a href="https://www.myrupaya.in/" className="link">
              Home
            </a>
          </div>
        </div>
      </nav>

      <div className="content-container">
        {/* Title section in white box */}
        <div className="title-box">
          <h1>Movie Offers</h1>
        </div>

        {/* 50-50 split section */}
        <div className="split-section">
          <div className="text-section">
            <h2>Find the Best Movie Offers</h2>
            <p>
              Discover exclusive movie offers and discounts available with your credit or debit cards. 
              Whether you're planning to visit PVR, INOX, or BookMyShow, we've got you covered with 
              the latest deals and promotions to enhance your movie experience.
            </p>
          </div>
          <div className="image-section">
            <img 
              src="https://via.placeholder.com/500x300?text=Movie+Offers" 
              alt="Movie Offers" 
              className="movie-image"
            />
          </div>
        </div>

        <div className="creditCardDropdown" style={{ position: "relative", width: "600px", margin: "0 auto" }}>
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Type a Credit/Debit Card..."
            style={{
              width: "100%",
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
                width: "100%",
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
                      borderBottom:
                        index !== filteredCards.length - 1
                          ? "1px solid #eee"
                          : "none",
                    }}
                    onMouseOver={(e) =>
                      (e.target.style.backgroundColor = "#f0f0f0")
                    }
                    onMouseOut={(e) =>
                      (e.target.style.backgroundColor = "transparent")
                    }
                  >
                    {item.card}
                  </li>
                )
              )}
            </ul>
          )}
        </div>

        {showNoCardMessage && (
          <div style={{
            textAlign: "center",
            margin: "40px 0",
            fontSize: "20px",
            color: "red",
            fontWeight: "bold"
          }}>
            No offers for this card
          </div>
        )}

        {selectedCard && !hasAnyOffers() && !showNoCardMessage && (
          <div style={{
            textAlign: "center",
            margin: "40px 0",
            fontSize: "20px",
            color: "#666"
          }}>
            No offers found for {selectedCard}
          </div>
        )}

        {selectedCard && hasAnyOffers() && (
          <div className="offer-section">
            {selectedMovieBenefits.length > 0 && (
              <div className="offer-container">
                <h2 style={{ textAlign: "center", margin: "20px 0" }}>Permanent Offers on {selectedCard}</h2>
                <div className="offer-row">
                  {selectedMovieBenefits.map((benefit, index) => (
                    <div key={`benefit-${index}`} className="offer-card" style={{backgroundColor: "#39641D", color: "white"}}>
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
                      <h3>{benefit["Credit Card Name"] || "Card Offer"}</h3>
                      {benefit["Movie Benefit"] && <p><strong>Benefit:</strong> {benefit["Movie Benefit"]}</p>}
                      {benefit.Terms && <p><strong>Terms:</strong> {benefit.Terms}</p>}
                      {benefit.Link && (
                        <button 
                          onClick={() => window.open(benefit.Link, "_blank")}
                          className="view-details-btn"
                        >
                          View Details
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedPvrOffers.length > 0 && (
              <div className="offer-container">
                <h2>PVR Offers</h2>
                <div className="offer-row">
                  {selectedPvrOffers.map((offer, index) => (
                    <div 
                      key={`pvr-${index}`} 
                      className={`offer-card ${expandedOfferIndex.pvr === index ? 'expanded' : ''}`}
                      style={{
                        backgroundColor: "#f5f5f5", 
                        color: "black",
                        height: expandedOfferIndex.pvr === index ? 'auto' : '400px',
                        overflow: 'hidden'
                      }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Title || "PVR Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Title || "PVR Offer"}</h3>
                      {offer.Validity && <p><strong>Validity:</strong> {offer.Validity}</p>}
                      
                      {expandedOfferIndex.pvr === index && (
                        <div className="terms-container" style={{ 
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '10px',
                          backgroundColor: 'rgba(0,0,0,0.1)',
                          borderRadius: '5px',
                          marginTop: '10px'
                        }}>
                          <h4>Offer Details:</h4>
                          <p>{offer.Offers}</p>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => toggleOfferDetails("pvr", index)}
                        className={`details-btn ${expandedOfferIndex.pvr === index ? "active" : ""}`}
                        style={{ marginTop: '10px' }}
                      >
                        {expandedOfferIndex.pvr === index ? "Hide Details" : "Click For More Details"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedInoxOffers.length > 0 && (
              <div className="offer-container">
                <h2>INOX Offers</h2>
                <div className="offer-row">
                  {selectedInoxOffers.map((offer, index) => (
                    <div 
                      key={`inox-${index}`} 
                      className={`offer-card ${expandedOfferIndex.inox === index ? 'expanded' : ''}`}
                      style={{
                        backgroundColor: "#f5f5f5", 
                        color: "black",
                        height: expandedOfferIndex.inox === index ? 'auto' : '400px',
                        overflow: 'hidden'
                      }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Title || "INOX Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Title || "INOX Offer"}</h3>
                      {offer.Validity && <p><strong>Validity:</strong> {offer.Validity}</p>}
                      
                      {expandedOfferIndex.inox === index && (
                        <div className="terms-container" style={{ 
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '10px',
                          backgroundColor: 'rgba(0,0,0,0.1)',
                          borderRadius: '5px',
                          marginTop: '10px'
                        }}>
                          <h4>Offer Details:</h4>
                          <p>{offer.Offers}</p>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => toggleOfferDetails("inox", index)}
                        className={`details-btn ${expandedOfferIndex.inox === index ? "active" : ""}`}
                        style={{ marginTop: '10px' }}
                      >
                        {expandedOfferIndex.inox === index ? "Hide Details" : "Click For More Details"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedBookMyShowOffers.length > 0 && (
              <div className="offer-container">
                <h2>BookMyShow Offers</h2>
                <div className="offer-row">
                  {selectedBookMyShowOffers.map((offer, index) => (
                    <div 
                      key={`bms-${index}`} 
                      className={`offer-card ${expandedOfferIndex.bms === index ? 'expanded' : ''}`}
                      style={{
                        backgroundColor: "#f5f5f5", 
                        color: "black",
                        height: expandedOfferIndex.bms === index ? 'auto' : '400px',
                        overflow: 'hidden'
                      }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Title || "BookMyShow Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Title || "BookMyShow Offer"}</h3>
                      {offer.Offer && <p><strong>Offer:</strong> {offer.Offer}</p>}
                      {offer.Validity && <p><strong>Validity:</strong> {offer.Validity}</p>}
                      
                      {expandedOfferIndex.bms === index && (
                        <div className="terms-container" style={{ 
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '10px',
                          backgroundColor: 'rgba(0,0,0,0.1)',
                          borderRadius: '5px',
                          marginTop: '10px'
                        }}>
                          <h4>Offer Details:</h4>
                          <p>{offer.Offers || "No additional details available"}</p>
                        </div>
                      )}
                      
                      {offer.Link ? (
                        <a 
                          href={offer.Link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          <button 
                            className="view-details-btn"
                            style={{ marginTop: '10px', cursor: 'pointer' }}
                          >
                            View Details
                          </button>
                        </a>
                      ) : (
                        <button 
                          onClick={() => toggleOfferDetails("bms", index)}
                          className={`details-btn ${expandedOfferIndex.bms === index ? "active" : ""}`}
                          style={{ marginTop: '10px' }}
                        >
                          {expandedOfferIndex.bms === index ? "Hide Details" : "Click For More Details"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedMovieDebitOffers.length > 0 && (
              <div className="offer-container">
                <h2>Debit Card Offers</h2>
                <div className="offer-row">
                  {selectedMovieDebitOffers.map((offer, index) => (
                    <div 
                      key={`debit-${index}`} 
                      className="offer-card" 
                      style={{ backgroundColor: "#39641D", color: "white" }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Website || "Debit Card Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Website || "Debit Card Offer"}</h3>
                      {offer.Offer && <p>{offer.Offer}</p>}
                      {offer.Link && (
                        <a 
                          href={offer.Link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="view-details-btn"
                          style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            backgroundColor: "white",
                            color: "#39641D",
                            borderRadius: "5px",
                            textDecoration: "none",
                            fontWeight: "bold",
                            marginTop: "10px"
                          }}
                        >
                          View Details
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          
          </div>    )}
          
            {/* 3-column FAQ section */}
            <div className="faq-section">
              <div className="faq-column">
                <h3>Question 1</h3>
                <p>Answer to question 1 goes here. This should provide helpful information about movie offers.</p>
              </div>
              <div className="faq-column">
                <h3>Question 2</h3>
                <p>Answer to question 2 goes here. This should provide helpful information about movie offers.</p>
              </div>
              <div className="faq-column">
                <h3>Question 3</h3>
                <p>Answer to question 3 goes here. This should provide helpful information about movie offers.</p>
              </div>
            </div>
     
      </div>
    </div>
  );
};

export default CreditCardDropdown;