-- Contrato compartilhado pelos verificadores 03, 05 e 09. Nao executar isoladamente.
-- A lista deve coincidir byte a byte com scripts/bootstrap/expectedMigrations.ts; teste publico garante isso.
SET LOCAL rustika.expected_migrations = '[
  {"ord":1,"migration_name":"20261023000000_initial_schema","checksum":"1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983"},
  {"ord":2,"migration_name":"20261027000000_rf004_comandas_catalogo_pedidos","checksum":"05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122"},
  {"ord":3,"migration_name":"20261031000000_rf004_fix_permissions","checksum":"960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b"},
  {"ord":4,"migration_name":"20261102000000_update_products_source_identity_constraint","checksum":"885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f"},
  {"ord":5,"migration_name":"20261104000000_runtime_least_privilege","checksum":"24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e"},
  {"ord":6,"migration_name":"20261105000000_order_status_update_privilege","checksum":"3d6a7a6d0ce3f595501dc6343c19858beb2b9fecd1ebe1fd1fbecf5603031d84"},
  {"ord":7,"migration_name":"20261106000000_product_availability_update_privilege","checksum":"3665ed812c4033527d17c6de3a7c66a623d659d676c719fc1b6f6477f7e69308"},
  {"ord":8,"migration_name":"20261110000000_rf006_product_crud_privilege","checksum":"b3feb0dfca618498219161ec91f11b4edff9700de5386e452edf67eadf41561e"},
  {"ord":9,"migration_name":"20261114000000_product_insert_identity_columns","checksum":"6a533537645a8b2f3c14af2c863697cbe9bfdec034319971b50020fe134318c9"}
]';
