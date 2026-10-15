-- ============================================================================
-- HUBy - Consultas Espaciais PostGIS para Proximidade de Frotas
-- ============================================================================

-- 1. Certificar que a extensão espacial está ativa
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Atualizar a posição geográfica em tempo real de um motorista ou caminhão
-- (Recebe Latitude e Longitude do telemóvel do motorista)
CREATE OR REPLACE FUNCTION atualizar_gps_motorista(
    p_motorista_id UUID,
    p_longitude DOUBLE PRECISION,
    p_latitude DOUBLE PRECISION
) RETURNS VOID AS $$
BEGIN
    UPDATE motoristas
    SET localizacao = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
        atualizado_em = CURRENT_TIMESTAMP
    WHERE id = p_motorista_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Encontrar motoristas e caminhões disponíveis num raio de 5 km da origem do cliente
-- (Filtra automaticamente pela categoria solicitada: Carro, Moto, Flash ou Cargo)
CREATE OR REPLACE FUNCTION buscar_motoristas_proximos(
    p_origem_lng DOUBLE PRECISION,
    p_origem_lat DOUBLE PRECISION,
    p_categoria_req VARCHAR,
    p_raio_metros INT DEFAULT 5000
) 
RETURNS TABLE (
    motorista_id UUID,
    nome_motorista VARCHAR,
    distancia_metros DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id,
        m.nome,
        ST_Distance(
            m.localizacao, 
            ST_SetSRID(ST_MakePoint(p_origem_lng, p_origem_lat), 4326)::geography
        ) AS distancia,
        ST_Y(m.localizacao::geometry) AS lat,
        ST_X(m.localizacao::geometry) AS lng
    FROM motoristas m
    WHERE m.status_online = TRUE
      AND m.categoria_principal = p_categoria_req
      AND ST_DWithin(
          m.localizacao,
          ST_SetSRID(ST_MakePoint(p_origem_lng, p_origem_lat), 4326)::geography,
          p_raio_metros
      )
    ORDER BY distancia ASC;
END;
$$ LANGUAGE plpgsql;