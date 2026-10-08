-- =====================================================================
-- V101__dbm_drivers_padrao.sql
-- Catalogo inicial de drivers JDBC (spec 14.20).
--
-- Sem driver nao ha primeira conexao: dbm_conexao aponta para dbm_driver.
-- `download_url` fica NULL enquanto o canal de download do fabricante nao
-- esta decidido (Oracle/SQL Server tem canal proprio, fora do Maven Central).
-- `checksum_sha256` fica NULL e `verificado_em` tambem: driver registrado e
-- ainda nao baixado/verificado e um estado legitimo (0.20).
-- =====================================================================

INSERT INTO dbm_driver (nome, fabricante, versao, jdbc_class, jdbc_url_template, suportado_nivel)
VALUES
  ('PostgreSQL JDBC', 'PostgreSQL', '42.7.x', 'org.postgresql.Driver',
   'jdbc:postgresql://HOST:5432/BANCO', 'CERTIFICADO'),
  ('MySQL Connector/J', 'MySQL', '9.x', 'com.mysql.cj.jdbc.Driver',
   'jdbc:mysql://HOST:3306/BANCO', 'COMPATIVEL'),
  ('MariaDB Connector/J', 'MariaDB', '3.x', 'org.mariadb.jdbc.Driver',
   'jdbc:mariadb://HOST:3306/BANCO', 'COMPATIVEL'),
  ('Microsoft SQL Server JDBC', 'Microsoft', '12.x', 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
   'jdbc:sqlserver://HOST:1433;databaseName=BANCO', 'COMPATIVEL'),
  ('Oracle JDBC thin', 'Oracle', '23.x', 'oracle.jdbc.OracleDriver',
   'jdbc:oracle:thin:@//HOST:1521/SERVICO', 'COMPATIVEL'),
  ('H2 Database', 'H2', '2.x', 'org.h2.Driver',
   'jdbc:h2:tcp://HOST:9092/BANCO', 'COMPATIVEL')
ON CONFLICT DO NOTHING;