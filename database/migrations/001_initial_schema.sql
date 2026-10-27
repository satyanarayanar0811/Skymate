-- SkyMate Phase 0 schema. MySQL 8.4. All timestamps are stored in UTC.
CREATE DATABASE IF NOT EXISTS airline CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE airline;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT IGNORE INTO roles(name,description) VALUES ('customer','Standard traveller'),('admin','Full administrative access'),('support','Customer support operations');

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NULL UNIQUE,
  phone VARCHAR(32) NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NULL,
  role ENUM('customer','admin','support') NOT NULL DEFAULT 'customer',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_created(role,created_at), INDEX idx_users_name(full_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  destination VARCHAR(254) NOT NULL,
  channel ENUM('email','sms') NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_otp_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_otp_destination_channel(destination,channel,expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS airports (
  code CHAR(3) NOT NULL PRIMARY KEY,
  city VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  country VARCHAR(120) NOT NULL,
  timezone VARCHAR(80) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  INDEX idx_airports_city(city), INDEX idx_airports_country(country)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS routes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  departure_code CHAR(3) NOT NULL,
  arrival_code CHAR(3) NOT NULL,
  distance_km INT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_routes_pair(departure_code,arrival_code),
  CONSTRAINT fk_routes_departure FOREIGN KEY(departure_code) REFERENCES airports(code),
  CONSTRAINT fk_routes_arrival FOREIGN KEY(arrival_code) REFERENCES airports(code),
  INDEX idx_routes_active(active)
) ENGINE=InnoDB;

-- Compatibility table: each row represents a dated demo flight used by the current API.
CREATE TABLE IF NOT EXISTS flights (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  flight_no VARCHAR(30) NOT NULL,
  airline VARCHAR(150) NOT NULL,
  departure_code CHAR(3) NULL,
  arrival_code CHAR(3) NULL,
  departure_at DATETIME NOT NULL,
  arrival_at DATETIME NOT NULL,
  economy_fare DECIMAL(10,2) NOT NULL,
  business_fare DECIMAL(10,2) NOT NULL,
  seats_available INT NOT NULL DEFAULT 30,
  status VARCHAR(80) NOT NULL DEFAULT 'On time',
  CONSTRAINT fk_flights_departure_airport FOREIGN KEY (departure_code) REFERENCES airports(code),
  CONSTRAINT fk_flights_arrival_airport FOREIGN KEY (arrival_code) REFERENCES airports(code),
  INDEX idx_flights_route_date (departure_code, arrival_code, departure_at),
  INDEX idx_flights_number (flight_no), INDEX idx_flights_status_date(status,departure_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flight_instances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  flight_id BIGINT UNSIGNED NOT NULL,
  route_id BIGINT UNSIGNED NULL,
  flight_date DATE NOT NULL,
  departure_at DATETIME NOT NULL,
  arrival_at DATETIME NOT NULL,
  premium_economy_fare DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('SCHEDULED','DELAYED','CANCELLED','DEPARTED','ARRIVED') NOT NULL DEFAULT 'SCHEDULED',
  gate VARCHAR(12) NULL,
  aircraft_type VARCHAR(80) NOT NULL DEFAULT 'A320',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_flight_instance(flight_id,flight_date),
  CONSTRAINT fk_instances_flight FOREIGN KEY(flight_id) REFERENCES flights(id) ON DELETE CASCADE,
  CONSTRAINT fk_instances_route FOREIGN KEY(route_id) REFERENCES routes(id) ON DELETE SET NULL,
  INDEX idx_instances_date_route(flight_date,route_id,status), INDEX idx_instances_departure(departure_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS seats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  flight_instance_id BIGINT UNSIGNED NOT NULL,
  seat_number VARCHAR(5) NOT NULL,
  cabin ENUM('economy','premium_economy','business') NOT NULL DEFAULT 'economy',
  type ENUM('standard','extra_legroom','emergency_exit','bassinet') NOT NULL DEFAULT 'standard',
  price_modifier DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  status ENUM('AVAILABLE','HELD','BOOKED','BLOCKED') NOT NULL DEFAULT 'AVAILABLE',
  hold_expires_at DATETIME NULL,
  UNIQUE KEY uq_instance_seat(flight_instance_id,seat_number),
  CONSTRAINT fk_seats_instance FOREIGN KEY(flight_instance_id) REFERENCES flight_instances(id) ON DELETE CASCADE,
  INDEX idx_seats_availability(flight_instance_id,cabin,status), INDEX idx_seats_hold_expiry(hold_expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(40) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  flight_id BIGINT UNSIGNED NULL,
  passenger_count INT NOT NULL,
  cabin_class VARCHAR(30) NOT NULL,
  seats JSON NOT NULL,
  passenger_details JSON NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'PENDING',
  payment_status VARCHAR(60) NOT NULL DEFAULT 'PENDING',
  refund_status VARCHAR(60) NOT NULL DEFAULT 'NOT_REQUESTED',
  checked_in BOOLEAN NOT NULL DEFAULT FALSE,
  email VARCHAR(254) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_flight FOREIGN KEY (flight_id) REFERENCES flights(id) ON DELETE SET NULL,
  INDEX idx_bookings_user (user_id), INDEX idx_bookings_status (status), INDEX idx_bookings_created(created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS passengers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  passenger_type ENUM('adult','child','infant') NOT NULL DEFAULT 'adult',
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  date_of_birth DATE NULL,
  passport_number VARCHAR(64) NULL,
  passport_country CHAR(2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_passengers_booking FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_passengers_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_passengers_booking(booking_id), INDEX idx_passengers_user(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_seats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NOT NULL,
  passenger_id BIGINT UNSIGNED NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_seat(booking_id,seat_id), UNIQUE KEY uq_seat_assignment(seat_id),
  CONSTRAINT fk_booking_seats_booking FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_seats_seat FOREIGN KEY(seat_id) REFERENCES seats(id),
  CONSTRAINT fk_booking_seats_passenger FOREIGN KEY(passenger_id) REFERENCES passengers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(40) NOT NULL,
  provider VARCHAR(80) NOT NULL DEFAULT 'mock',
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(60) NOT NULL,
  provider_reference VARCHAR(255) NULL,
  idempotency_key VARCHAR(120) NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_booking FOREIGN KEY(booking_ref) REFERENCES bookings(booking_ref) ON DELETE CASCADE,
  INDEX idx_transactions_booking_ref (booking_ref), INDEX idx_transactions_status_created(status,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refunds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(40) NOT NULL,
  transaction_id BIGINT UNSIGNED NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('REQUESTED','PROCESSING','REFUNDED','FAILED','REJECTED') NOT NULL DEFAULT 'REQUESTED',
  reason VARCHAR(500) NULL,
  provider_reference VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_refunds_booking FOREIGN KEY(booking_ref) REFERENCES bookings(booking_ref) ON DELETE CASCADE,
  CONSTRAINT fk_refunds_transaction FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  INDEX idx_refunds_booking(booking_ref), INDEX idx_refunds_status(status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  discount_type ENUM('PERCENT','FIXED') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_promotions_active_dates(active,starts_at,ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  discount_type ENUM('PERCENT','FIXED') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  max_discount DECIMAL(10,2) NULL,
  min_order_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  usage_limit INT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coupons_active_dates(active,starts_at,ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  coupon_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  booking_ref VARCHAR(40) NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL,
  redeemed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupon_booking(coupon_id,booking_ref),
  CONSTRAINT fk_redemption_coupon FOREIGN KEY(coupon_id) REFERENCES coupons(id),
  CONSTRAINT fk_redemption_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_redemption_booking FOREIGN KEY(booking_ref) REFERENCES bookings(booking_ref) ON DELETE CASCADE,
  INDEX idx_redemptions_user(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(160) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  summary TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_conversations_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_conversation_session(session_id), INDEX idx_conversations_user(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NULL,
  role VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  intent VARCHAR(100) NULL,
  intent_confidence DECIMAL(5,4) NULL,
  entities JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_messages_conversation_created (conversation_id, created_at), INDEX idx_messages_intent(intent,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS intents (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, description VARCHAR(255) NULL, active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS entities (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, description VARCHAR(255) NULL, entity_type VARCHAR(60) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS prompts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  prompt_text TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prompt_version(name,version), INDEX idx_prompts_active(name,active)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS faq_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  embedding_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FULLTEXT KEY ft_faq_content(title,content), INDEX idx_faq_category(category,active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS email_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(254) NULL,
  template VARCHAR(160) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  provider_reference VARCHAR(255) NULL,
  error_message VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_logs_created(created_at), INDEX idx_email_logs_status(status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sms_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(40) NULL,
  template VARCHAR(160) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  provider_reference VARCHAR(255) NULL,
  error_message VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sms_logs_created(created_at), INDEX idx_sms_logs_status(status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(40) NULL,
  template VARCHAR(160) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  provider_reference VARCHAR(255) NULL,
  error_message VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_whatsapp_logs_created(created_at), INDEX idx_whatsapp_logs_status(status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  channel VARCHAR(40) NOT NULL,
  recipient VARCHAR(255) NULL,
  template VARCHAR(160) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notification_logs_created (created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(40) NULL,
  user_id BIGINT UNSIGNED NULL,
  email VARCHAR(254) NULL,
  message TEXT NOT NULL,
  summary TEXT NULL,
  assigned_to BIGINT UNSIGNED NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tickets_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_assignee FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_booking FOREIGN KEY(booking_ref) REFERENCES bookings(booking_ref) ON DELETE SET NULL,
  INDEX idx_support_tickets_status (status,created_at), INDEX idx_support_tickets_email(email)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(120) NULL,
  request_id VARCHAR(100) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_actor_created(actor_user_id,created_at), INDEX idx_audit_resource(resource_type,resource_id), INDEX idx_audit_action_created(action,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  session_id VARCHAR(160) NULL,
  event_name VARCHAR(120) NOT NULL,
  properties JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_analytics_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_analytics_event_date(event_name,created_at), INDEX idx_analytics_session(session_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS revenue_daily (
  revenue_date DATE NOT NULL PRIMARY KEY,
  booking_count INT UNSIGNED NOT NULL DEFAULT 0,
  gross_revenue DECIMAL(14,2) NOT NULL DEFAULT 0,
  refunds DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_revenue DECIMAL(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO intents(name,description) VALUES
('greeting','Greeting or welcome'),('book_flight','Search or book a flight'),('flight_status','Flight status'),('cancel_booking','Cancel a booking'),('modify_booking','Modify an existing booking'),('refund','Refund status'),('check_in','Web check-in'),('baggage','Baggage policy'),('fare_comparison','Compare fares'),('human_agent','Request human support'),('faq','Frequently asked question'),('out_of_scope','Request outside airline assistance');
INSERT IGNORE INTO entities(name,description,entity_type) VALUES
('departure_city','Departure city or airport','location'),('arrival_city','Arrival city or airport','location'),('travel_date','Outbound travel date','date'),('return_date','Return travel date','date'),('passenger_count','Number of travellers','number'),('cabin_class','Requested cabin class','category'),('booking_reference','Booking reference or PNR','identifier'),('flight_number','Airline flight number','identifier');
INSERT IGNORE INTO prompts(name,version,prompt_text,active) VALUES
('Flight Search',1,'Use database-backed flight search results only. Never invent fares, schedules, or seat availability.',1),
('Fare Recommendation',1,'Compare only returned fares and clearly state fare rules when known. Never invent policy.',1),
('Travel Policy',1,'Answer from retrieved policy documents only. If no source is found, say the policy needs confirmation.',1),
('FAQ',1,'Answer from seeded FAQ documents or explicitly state when information is unavailable.',1),
('Booking Assistance',1,'Use booking tools and persisted booking records. Never claim a booking exists unless the database confirms it.',1);
