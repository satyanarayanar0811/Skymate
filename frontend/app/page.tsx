'use client';

import {useEffect,useMemo,useRef,useState} from 'react';

const API=(process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api').replace(/\/$/,'');

type Flight={id:string;flightNo:string;airline:string;from:string;to:string;fromCity:string;toCity:string;departure:string;arrival:string;economy:number;business:number;price:number;seatsAvailable:number;status:string;date:string;demo:boolean;source?:'local'|'duffel';originalCurrency?:string;originalPrice?:number;stops?:number};

type Booking={ref:string;flight:Flight;passengers:number;cabin:string;seats:string[];names:string[];email:string;amount:number;status:string;paymentStatus:string;refundStatus:string;checkedIn:boolean};

type Message = {

  role: 'bot' | 'user';

  text: string;

  flights?: Flight[];

};

async function api(path:string,options?:RequestInit){const r=await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json',...(options?.headers||{})}});const data=await r.json();if(!r.ok)throw new Error(data.error||data.detail||'Request failed');return data;}

export default function Home(){

 const [auth,setAuth]=useState<any>(null);

 const [sessionId,setSessionId]=useState('');

 const [authEmail,setAuthEmail]=useState('');

 const [authOtp,setAuthOtp]=useState('');

 const [authStep,setAuthStep]=useState<'email'|'otp'>('email');

 const [authBusy,setAuthBusy]=useState(false);

 const [authError,setAuthError]=useState('');

 useEffect(()=>{try{const raw=localStorage.getItem('skymate-auth');if(raw)setAuth(JSON.parse(raw));}catch{}setSessionId(crypto.randomUUID());},[]);

 async function requestOtp(){setAuthError('');setAuthBusy(true);try{const d=await api('/auth/send-otp',{method:'POST',body:JSON.stringify({email:authEmail})});setAuthStep('otp');setAuthError(d.message||'Code sent.');}catch(e){setAuthError(String(e));}finally{setAuthBusy(false);}}

 async function verifyOtp(){setAuthError('');setAuthBusy(true);try{const d=await api('/auth/verify-otp',{method:'POST',body:JSON.stringify({email:authEmail,otp:authOtp})});localStorage.setItem('skymate-auth',JSON.stringify(d));setAuth(d);setAuthError('');}catch(e){setAuthError(String(e));}finally{setAuthBusy(false);}}

 async function continueGuest(){setAuthError('');setAuthBusy(true);try{const d=await api('/auth/guest',{method:'POST',body:JSON.stringify({})});localStorage.setItem('skymate-auth',JSON.stringify(d));setAuth(d);}catch(e){setAuthError(String(e));}finally{setAuthBusy(false);}}

 function signOut(){localStorage.removeItem('skymate-auth');setAuth(null);setAuthStep('email');setAuthOtp('');}



 const [messages,setMessages]=useState<Message[]>([{role:'bot',text:'Welcome to SkyMate 👋\nI can help you search flights, compare fares, review itineraries and manage reservations. What can I help you with?'}]);

 const [message,setMessage]=useState('');const [loading,setLoading]=useState(false);

 const [from,setFrom]=useState('BLR'),[to,setTo]=useState('DEL'),[date,setDate]=useState(new Date(Date.now()+86400000).toISOString().slice(0,10));

 const [trip,setTrip]=useState('one-way'),[returnDate,setReturnDate]=useState(''),[passengers,setPassengers]=useState(1),[cabin,setCabin]=useState('economy');

 const [results,setResults]=useState<Flight[]>([]),[selected,setSelected]=useState<Flight|null>(null),[seats,setSeats]=useState<string[]>([]);

 const [names,setNames]=useState('Alex Traveller'),[email,setEmail]=useState('guest@example.com'),[bookingRef,setBookingRef]=useState(''),[booking,setBooking]=useState<Booking|null>(null);

 const [notice,setNotice]=useState('');const [flightNo,setFlightNo]=useState('AI234');const [supportText,setSupportText]=useState('');

 const chatEnd=useRef<HTMLDivElement>(null);useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:'smooth'});},[messages]);

 const seatOptions=useMemo(()=>Array.from({length:24},(_,i)=>`${Math.floor(i/6)+1}${String.fromCharCode(65+(i%6))}`),[]);

 async function send(text = message) {
    if (!text.trim() || loading) return;
    const userText = text.trim();
    const activeSessionId = sessionId || crypto.randomUUID();
    if (!sessionId) {
      setSessionId(activeSessionId);
    }
    setMessage('');
    setMessages(current => [...current, { role: 'user', text: userText }]);
    setLoading(true);
    try {
      const data = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({ message: userText, sessionId: activeSessionId, trip_type: trip === 'round-trip' ? 'round_trip' : 'one_way', passengers })
      });
      if (data.nextAction === 'booking_payment') {
        const created = await api('/chat-bookings', {
          method: 'POST',
          body: JSON.stringify({ booking: data.entities?.bookingFlow })
        });
        window.location.assign(created.paymentUrl);
        return;
      }
      const offers = data.toolResult?.offers;
      let mappedFlights: Flight[] = [];
      const countMatch =
        userText.match(/\b(?:top|first|show|return|give|list|provide)\s+(?:the\s+)?(\d{1,2})\b/i) ||
        userText.match(/\b(\d{1,2})\s+(?:cheapest|lowest|flight|flights|offers|options|results)\b/i);
      const requestedCount = countMatch
        ? Math.max(1, Math.min(20, Number(countMatch[1])))
        : null;
      const asksCheapest = /\b(cheapest|lowest[- ]priced|lowest fare|least expensive)\b/i.test(userText);
      const explicitlyFresh =
        /\b(?:do not|don't|dont|never)\s+(?:reuse|use)\b.*\b(previous|old|cached)\b/i.test(userText) ||
        /\b(new|fresh)\s+search\b/i.test(userText);
      const hasSearchConstraint =
        /\b(business class|premium economy|first class|economy class)\b/i.test(userText) ||
        /\bfrom\s+[a-z][a-z\s-]*\s+to\s+[a-z][a-z\s-]*\b/i.test(userText) ||
        /\b(?:today|tomorrow|next\s+\w+|\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})\b/i.test(userText);

      if (Array.isArray(offers) && offers.length > 0) {
        const rate = Number(process.env.NEXT_PUBLIC_GBP_TO_INR_RATE || 115);
        mappedFlights = offers.map((offer: any, index: number) => {
          const originalPrice = Number(offer.total ?? offer.price ?? 0);
          const currency = String(offer.currency ?? 'INR').toUpperCase();
          const displayPrice = currency === 'GBP' ? originalPrice * rate : originalPrice;
          const departureAt = String(offer.departureAt ?? offer.departure_at ?? '');
          const arrivalAt = String(offer.arrivalAt ?? offer.arrival_at ?? '');
          const origin = String(offer.departureAirport ?? offer.origin ?? offer.from ?? from);
          const destination = String(offer.arrivalAirport ?? offer.destination ?? offer.to ?? to);
          return {
            id: String(offer.id ?? `provider-offer-${index}`),
            flightNo: String(offer.flightNumber ?? offer.flightNo ?? offer.flight_no ?? 'N/A'),
            airline: String(offer.airline ?? offer.ownerName ?? 'Airline not specified'),
            from: origin,
            to: destination,
            fromCity: origin,
            toCity: destination,
            departure: departureAt.includes('T') ? departureAt.slice(11, 16) : departureAt,
            arrival: arrivalAt.includes('T') ? arrivalAt.slice(11, 16) : arrivalAt,
            economy: displayPrice / Math.max(1, passengers),
            business: displayPrice / Math.max(1, passengers),
            price: displayPrice,
            seatsAvailable: Number(offer.seatsAvailable ?? 0),
            status: 'AVAILABLE',
            date: departureAt.slice(0, 10),
            demo: true,
            source: 'duffel' as const,
            originalCurrency: currency,
            originalPrice,
            stops: Number(offer.stops ?? 0)
          };
        });
        if (asksCheapest) mappedFlights = [...mappedFlights].sort((a, b) => a.price - b.price);
        if (requestedCount !== null) mappedFlights = mappedFlights.slice(0, requestedCount);
        setResults(mappedFlights);
      } else {
        const canReuseCurrentResults =
          !explicitlyFresh && !hasSearchConstraint && !asksCheapest && requestedCount === null &&
          /\b(list|show|display|provide|give|see|compare)\b/i.test(userText) &&
          /\b(flights?|offers?|options|results|fares)\b/i.test(userText) &&
          results.length > 0;
        if (canReuseCurrentResults) mappedFlights = results;
      }

      if (data.entities?.departureCity) setFrom(data.entities.departureCity);
      if (data.entities?.arrivalCity) setTo(data.entities.arrivalCity);
      if (data.entities?.date) setDate(data.entities.date);
      if (data.entities?.passengers) setPassengers(Number(data.entities.passengers));
      if (data.entities?.cabinClass) setCabin(data.entities.cabinClass);
      if (data.entities?.flightNo) setFlightNo(data.entities.flightNo);
      if (data.entities?.bookingRef) setBookingRef(data.entities.bookingRef);

      const action = String(data.nextAction ?? '');
      const isFlightResponse = mappedFlights.length > 0 &&
        (['show_flights', 'book_flight', 'fare_comparison', 'select_flight'].includes(action) || Array.isArray(offers));

      if (action === 'select_flight' && mappedFlights.length > 0) {
        const selectedOfferId = String(data.toolResult?.selected_offer_id ?? '');
        const selectedOffer = mappedFlights.find(flight => flight.id === selectedOfferId);
        if (selectedOffer) chooseFlight(selectedOffer);
      }

      if (isFlightResponse) {
        const flightReply = Array.isArray(offers) && offers.length > 0 &&
          (requestedCount !== null || asksCheapest)
          ? `I found ${offers.length} offers returned by the search. Showing ${mappedFlights.length} offer(s)${asksCheapest ? ', sorted by displayed fare' : ''}. Please verify the cabin class and final fare with the provider.`
          : data.reply || `I found ${mappedFlights.length} flight options. Choose a flight to review its details.`;
        setMessages(current => [...current, { role: 'bot', text: flightReply, flights: mappedFlights }]);
      } else {
        setMessages(current => [...current, { role: 'bot', text: data.reply || 'I could not find a response.' }]);
      }
    } catch (error) {
      setMessages(current => [...current, {
        role: 'bot',
        text: `I could not complete that request. Please try again. ${String(error)}`
      }]);
    } finally {
      setLoading(false);
    }
  }

async function search(){
    setNotice('');
    setSelected(null);
    setBooking(null);
    setSeats([]);
    try {
      const query = new URLSearchParams({
        origin: from,
        destination: to,
        date,
        adults: String(passengers),
        cabin
      });
      if (trip === 'round-trip' && returnDate) query.set('returnDate', returnDate);
      const response = await api(`/integrations/flights/search?${query.toString()}`);
      const offers = Array.isArray(response.offers) ? response.offers : [];
      const rate = Number(process.env.NEXT_PUBLIC_GBP_TO_INR_RATE || 115);
      const mapped: Flight[] = offers.map((offer: any, index: number) => {
        const originalPrice = Number(offer.total ?? offer.price ?? 0);
        const currency = String(offer.currency ?? 'INR').toUpperCase();
        const displayPrice = currency === 'GBP' ? originalPrice * rate : originalPrice;
        const departureAt = String(offer.departureAt ?? '');
        const arrivalAt = String(offer.arrivalAt ?? '');
        const origin = String(offer.departureAirport ?? from);
        const destination = String(offer.arrivalAirport ?? to);
        return {
          id: String(offer.id ?? `provider-offer-${index}`),
          flightNo: String(offer.flightNumber ?? 'N/A'),
          airline: String(offer.airline ?? 'Airline not specified'),
          from: origin, to: destination, fromCity: origin, toCity: destination,
          departure: departureAt.includes('T') ? departureAt.slice(11,16) : departureAt,
          arrival: arrivalAt.includes('T') ? arrivalAt.slice(11,16) : arrivalAt,
          economy: displayPrice / Math.max(1, passengers),
          business: displayPrice / Math.max(1, passengers),
          price: displayPrice,
          seatsAvailable: Number(offer.seatsAvailable ?? 0),
          status: 'AVAILABLE',
          date: departureAt.slice(0,10),
          demo: true,
          source: 'duffel' as const,
          originalCurrency: currency,
          originalPrice,
          stops: Number(offer.stops ?? 0)
        };
      });
      setResults(mapped);
      setNotice(
        mapped.length
          ? `${mapped.length} flights found. Displayed INR fares are approximate where currency conversion is required; confirm final fare and availability with the airline.`
          : 'No flights were returned for this route and date. Try another date or route.'
      );
    } catch (error) {
      setResults([]);
      setNotice(error instanceof Error ? error.message : 'Flight search could not be completed.');
    }
  }

  function chooseFlight(flight: Flight) {
    setSelected(flight);
    setSeats([]);
    setNotice(flight.source === 'duffel'
      ? `Selected ${flight.airline} ${flight.flightNo}. This provider offer cannot be booked through the currently configured reservation flow.`
      : `Selected ${flight.airline} ${flight.flightNo}. Choose a seat for each passenger, enter passenger names, then continue to payment and reservation confirmation.`
    );
  }

  async function createBooking(){if(!selected)return;if(selected.source==='duffel'){setNotice('This provider offer cannot be submitted to the currently configured reservation service. Please choose an eligible offer or configure provider booking support.');return;}const passengerNames=names.split(',').map(n=>n.trim()).filter(Boolean);if(passengerNames.length!==passengers){setNotice(`Enter exactly ${passengers} passenger name(s), separated by commas.`);return;}if(seats.length!==passengers){setNotice(`Choose exactly ${passengers} unique seat(s).`);return;}try{const d=await api('/bookings',{method:'POST',body:JSON.stringify({flightId:selected.id,passengers,cabin,seats,names:passengerNames,email})});setBooking(d.booking);setBookingRef(d.booking.ref);setNotice(d.message);}catch(e){setNotice(String(e));}}

 async function loadBooking(){try{const d=await api(`/bookings/${encodeURIComponent(bookingRef.trim())}`);setBooking(d.booking);setNotice('Booking loaded. Review status before taking action.');}catch(e){setBooking(null);setNotice(String(e));}}

 async function cancelBooking(){if(!booking||!window.confirm(`Cancel reservation ${booking.ref}?`))return;try{const d=await api(`/bookings/${booking.ref}/cancel`,{method:'POST',body:'{}'});setBooking(d.booking);setNotice(d.message);}catch(e){setNotice(String(e));}}

 async function checkin(){if(!booking)return;try{const d=await api(`/bookings/${booking.ref}/checkin`,{method:'POST',body:'{}'});setBooking(d.booking);const response=await fetch(`${API}/bookings/${booking.ref}/boarding-pass.pdf`,{headers:{Authorization:`Bearer ${auth?.token||''}`}});if(response.ok){const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${booking.ref}-boarding-pass.pdf`;a.click();URL.revokeObjectURL(url);setNotice('Boarding-pass document downloaded. Check with the operating airline before travel.');}else{const blob=new Blob([d.boardingPass],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${booking.ref}-boarding-pass.txt`;a.click();URL.revokeObjectURL(url);setNotice('PDF was unavailable; a text document was downloaded. Confirm travel documents with the operating airline.');}}catch(e){setNotice(String(e));}}

 async function status(){try{const d=await api(`/status/${encodeURIComponent(flightNo)}`);setNotice(`${d.flightNo}: ${d.status}\nRoute: ${d.from} → ${d.to}\nDeparture: ${d.departure} · Arrival: ${d.arrival}\nCheck the operating airline for current flight status.`);}catch(e){setNotice(String(e));}}

 async function support(){try{const d=await api('/support',{method:'POST',body:JSON.stringify({message:supportText,email})});setNotice(`Support ticket ${d.ticket.id} · ${d.ticket.status}\n${d.message}`);setSupportText('');}catch(e){setNotice(String(e));}}

 if(!auth)return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><div className="logo">S</div><div><h1>SkyMate</h1><p>Airline reservations, made simpler</p></div></div><div className="auth-kicker">WELCOME ABOARD</div><h2>{authStep==='email'?'Sign in or create an account':'Verify your email'}</h2><p className="auth-sub">{authStep==='email'?'Enter your email and we’ll send you a one-time verification code. Or continue as a guest.':`We sent a 6-digit code to ${authEmail}. It expires in 5 minutes.`}</p>{authStep==='email'?<><label className="field">Email address<input type="email" autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="you@example.com"/></label><button className="primary auth-wide" disabled={authBusy||!authEmail.trim()} onClick={()=>void requestOtp()}>{authBusy?'Sending…':'Continue with email'}</button><div className="auth-divider"><span>OR</span></div><button className="secondary auth-wide" disabled={authBusy} onClick={()=>void continueGuest()}>Continue as guest</button></>:<><label className="field">Verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={authOtp} onChange={e=>setAuthOtp(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code"/></label><button className="primary auth-wide" disabled={authBusy||authOtp.length!==6} onClick={()=>void verifyOtp()}>{authBusy?'Verifying…':'Verify email & sign in'}</button><button className="secondary auth-wide" disabled={authBusy} onClick={()=>{setAuthStep('email');setAuthOtp('');setAuthError('');}}>Use a different email</button></>}{authError&&<p className="auth-error">{authError}</p>}<p className="auth-terms">Email sign-in requires configured SMTP delivery. You can also continue as a guest.</p></section></main>;

 return <main className="shell">

  <header className="top"><div className="brand"><div className="logo">S</div><div><h1>SkyMate</h1><p>AI-powered airline reservation assistant</p></div></div><nav className="top-links" aria-label="Account actions"><button className="secondary" onClick={signOut}>Sign out</button></nav><span className="pill">Airline reservations</span></header>

  <div className="layout"><section className="panel"><div className="panelhead"><h2>Your travel assistant</h2><p>Natural-language chat with intent recognition and guided actions</p></div>

   <div className="chat">
      {messages.map((m, i) => (
        <div key={i} className={`bubble ${m.role}`}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
          {m.flights && m.flights.length > 0 && (
            <div className="results" style={{ marginTop: 12 }}>
              {m.flights.map(f => (
                <article className="flight" key={f.id}>
                  <div className="flighttop">
                    <div>
                      <strong>{f.airline} · {f.flightNo}</strong>
                      <br />
                      <small>{f.departure} → {f.arrival}</small>
                      <br />
                      <small>{f.fromCity} → {f.toCity}{f.stops !== undefined ? ` · ${f.stops} stop(s)` : ''}{f.source === 'duffel' ? ' · provider offer' : ` · ${f.seatsAvailable} seats`}</small>
                    </div>
                    <div className="price">
                      ₹{f.price.toLocaleString('en-IN')}
                      <br />
                      <small>{f.source === 'duffel' ? 'approximate fare' : 'total fare'}</small>
                    </div>
                  </div>
                  <div className="actions">
                    <button type="button" className="secondary" onClick={() => chooseFlight(f)}>
                      Choose flight
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ))}
      <div ref={chatEnd} />
    </div>

   <div className="quickrow">{['Find a flight from Bangalore to Delhi tomorrow','Check AI234 status','Baggage information','Where is my refund?','Contact support'].map(q=><button className="quick" key={q} onClick={()=>send(q)}>{q}</button>)}</div>

   <form className="composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea rows={2} value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Ask about flights, booking, refunds…" aria-label="Chat message"/><button className="primary" disabled={loading}>{loading?'…':'Send'}</button></form>

  </section>

  <aside className="panel"><div className="panelhead"><h2>Travel workspace</h2><p>Search · book · manage · support</p></div>

   <div className="section"><h3>1. Search flights</h3><div className="fields">

    <label className="field">From<select value={from} onChange={e=>setFrom(e.target.value)}>{[['BLR','Bengaluru'],['DEL','Delhi'],['MAA','Chennai'],['BOM','Mumbai'],['HYD','Hyderabad'],['CCU','Kolkata'],['GOI','Goa'],['COK','Kochi'],['PNQ','Pune'],['AMD','Ahmedabad']].map(([v,l])=><option value={v} key={v}>{l} ({v})</option>)}</select></label>

    <label className="field">To<select value={to} onChange={e=>setTo(e.target.value)}>{[['DEL','Delhi'],['BLR','Bengaluru'],['BOM','Mumbai'],['MAA','Chennai'],['HYD','Hyderabad'],['CCU','Kolkata'],['GOI','Goa'],['COK','Kochi'],['PNQ','Pune'],['AMD','Ahmedabad']].map(([v,l])=><option value={v} key={v}>{l} ({v})</option>)}</select></label>

    <label className="field">Trip type<select value={trip} onChange={e=>setTrip(e.target.value)}><option value="one-way">One-way</option><option value="round-trip">Round-trip</option></select></label>

    <label className="field">Departure date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>

    {trip==='round-trip'&&<label className="field">Return date<input type="date" min={date} value={returnDate} onChange={e=>setReturnDate(e.target.value)}/></label>}

    <label className="field">Passengers<select value={passengers} onChange={e=>{setPassengers(Number(e.target.value));setSeats([]);}}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n} value={n}>{n}</option>)}</select></label>

    <label className="field full">Cabin class<select value={cabin} onChange={e=>setCabin(e.target.value)}><option value="economy">Economy</option><option value="business">Business</option></select></label>

   </div><div className="actions"><button className="primary" onClick={()=>void search()}>Search flights</button><button className="secondary" onClick={()=>{setFrom(to);setTo(from);}}>Swap route</button></div>

   {results.length>0&&<div className="results"><div className="smalltitle">{results.length} flight option(s)</div>{results.map(f=><article className="flight" key={f.id}><div className="flighttop"><div><strong>{f.airline} · {f.flightNo}</strong><br/><small>{f.departure} → {f.arrival}</small><br/><small>{f.fromCity} → {f.toCity}{f.stops !== undefined ? ` · ${f.stops} stop(s)` : ''}{f.source === 'duffel' ? ' · provider offer' : ` · ${f.seatsAvailable} seats`}</small></div><div className="price">₹{f.price.toLocaleString('en-IN')}<br/><small>{f.source === 'duffel' ? 'approximate fare' : 'total fare'}</small></div></div><div className="actions"><button type="button" className="secondary" onClick={() => chooseFlight(f)}>Choose flight</button></div></article>)}</div>}

   </div>

   <div className="section" style={{borderTop:'1px solid var(--line)'}}><h3>2. Passenger details & seat selection</h3>{!selected?<p className="empty">Choose a flight to review passenger details.</p>:<><p className="resulttext">{selected.airline} · {selected.flightNo} · ₹{((cabin==='business'?selected.business:selected.economy)*passengers).toLocaleString('en-IN')} estimated total</p><label className="field" style={{marginTop:12}}>Passenger names (comma-separated)<input value={names} onChange={e=>setNames(e.target.value)} placeholder="Name for each passenger"/></label><label className="field" style={{marginTop:12}}>Contact email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><div className="smalltitle" style={{marginTop:15}}>Select {passengers} seat(s)</div><div style={{display:'grid',gridTemplateColumns:'repeat(6,minmax(0,1fr))',gap:6}}>{seatOptions.map(s=><button key={s} className={seats.includes(s)?'primary':'quick'} style={{padding:'9px 2px'}} onClick={()=>setSeats(old=>old.includes(s)?old.filter(x=>x!==s):old.length<passengers?[...old,s]:[...old.slice(1),s])}>{s}</button>)}</div><div className="actions"><button className="primary" onClick={()=>void createBooking()}>Continue to payment</button><button className="secondary" onClick={()=>{setSelected(null);setSeats([]);}}>Back</button></div><p className="empty">Payments are processed only through the configured payment provider. Never enter card details directly into this form.</p></>}</div>

   <div className="section" style={{borderTop:'1px solid var(--line)'}}><h3>3. Booking management</h3><label className="field">Booking reference<input value={bookingRef} onChange={e=>setBookingRef(e.target.value)} placeholder="SKY-ABC123"/></label><div className="actions"><button className="secondary" onClick={()=>void loadBooking()}>Load booking</button><button className="secondary" onClick={()=>void cancelBooking()} disabled={!booking||booking.status.startsWith('CANCELLED')}>Cancel reservation</button><button className="secondary" onClick={()=>void checkin()} disabled={!booking||booking.status.startsWith('CANCELLED')}>Check in / download pass</button></div>

   {booking&&<div className="flight" style={{marginTop:12}}><span className="status">{booking.status}</span><p><strong>{booking.ref}</strong> · {booking.flight.flightNo}</p><p className="resulttext">{booking.flight.from} → {booking.flight.to}<br/>Passengers: {booking.names.join(', ')}<br/>Seats: {booking.seats.join(', ')}<br/>Total: ₹{booking.amount.toLocaleString('en-IN')}<br/>Payment: {booking.paymentStatus}<br/>Refund: {booking.refundStatus}<br/>Check-in: {booking.checkedIn?'Complete':'Not checked in'}</p></div>}</div>

   <div className="section" style={{borderTop:'1px solid var(--line)'}}><h3>4. Flight status</h3><label className="field">Flight number<input value={flightNo} onChange={e=>setFlightNo(e.target.value.toUpperCase())}/></label><div className="actions"><button className="secondary" onClick={()=>void status()}>Check status</button><button className="secondary" onClick={async()=>{try{const d=await api('/baggage');setNotice(d.message);}catch(e){setNotice(String(e));}}}>Baggage guidance</button></div></div>

   <div className="section" style={{borderTop:'1px solid var(--line)'}}><h3>5. Customer support</h3><label className="field">Describe your issue<textarea rows={3} value={supportText} onChange={e=>setSupportText(e.target.value)} placeholder="I need help changing my booking…"/></label><div className="actions"><button className="primary" onClick={()=>void support()}>Create support ticket</button><button className="secondary" onClick={async()=>{try{const d=await api('/admin/summary');setNotice(`Admin summary\nBookings: ${d.bookings}\nConfirmed: ${d.confirmed}\nCancelled: ${d.cancelled}\nSupport tickets: ${d.supportTickets}\nDemo revenue: ₹${d.revenue}`);}catch(e){setNotice(String(e));}}}>Admin summary</button></div></div>

   {notice&&<div className="section" style={{borderTop:'1px solid var(--line)'}}><div className="smalltitle">Activity / response</div><div className="resulttext">{notice}</div></div>}

  </aside></div>

  <div className="footer">Signed in as {auth?.user?.email || auth?.user?.name || "Guest"} · <button className="secondary" onClick={signOut}>Sign out</button><br/>SkyMate · Airline search and reservation services</div>

 </main>;

}
