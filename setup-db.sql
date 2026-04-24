-- Create database for glass claim assessment
CREATE DATABASE glass_claims_db;

-- Connect to the database
\c glass_claims_db

-- Create user with password
CREATE USER glass_user WITH PASSWORD 'glass_pass_2026';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE glass_claims_db TO glass_user;
GRANT ALL ON SCHEMA public TO glass_user;

-- Create single table with JSONB for flexible storage
CREATE TABLE claim_inspections (
    id SERIAL PRIMARY KEY,
    claim_id VARCHAR(36) UNIQUE NOT NULL,
    insurer_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    inspection_data JSONB NOT NULL,
    CONSTRAINT inspection_data_not_null CHECK (inspection_data IS NOT NULL)
);

-- Create indexes for common queries
CREATE INDEX idx_claim_id ON claim_inspections(claim_id);
CREATE INDEX idx_insurer_id ON claim_inspections(insurer_id);
CREATE INDEX idx_created_at ON claim_inspections(created_at);
CREATE INDEX idx_status ON claim_inspections USING GIN ((inspection_data->'status'));

-- Grant table permissions to user
GRANT ALL PRIVILEGES ON TABLE claim_inspections TO glass_user;
GRANT USAGE, SELECT ON SEQUENCE claim_inspections_id_seq TO glass_user;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_claim_inspections_updated_at
    BEFORE UPDATE ON claim_inspections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
