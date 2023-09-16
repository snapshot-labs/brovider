CREATE TABLE brovider.nodes (
  `url` VARCHAR(512) NOT NULL,
  `network` VARCHAR(256) NOT NULL,
  `provider` VARCHAR(256) NOT NULL,
  `requests` INT NOT NULL DEFAULT 0,
  `errors` INT NOT NULL DEFAULT 0,
  `duration` INT NOT NULL DEFAULT 0,
  `archive` TINYINT NOT NULL DEFAULT -1,
  `created` INT NOT NULL,
  PRIMARY KEY (`url`),
  INDEX `network` (`network`),
  INDEX `provider` (`provider`),
  INDEX `archive` (`archive`),
  INDEX `created` (`created`)
);
