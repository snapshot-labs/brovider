CREATE TABLE nodes (
  `url` VARCHAR(512) NOT NULL,
  `network` VARCHAR(256) NOT NULL,
  `provider` VARCHAR(256) NOT NULL,
  `requests` INT(24) NOT NULL DEFAULT 0,
  `errors` INT(24) NOT NULL DEFAULT 0,
  `duration` INT(24) NOT NULL DEFAULT 0,
  `archive` TINYINT(1) NOT NULL DEFAULT -1,
  `multicall` VARCHAR(256) NOT NULL,
  `created` INT(11) NOT NULL,
  PRIMARY KEY (`url`),
  INDEX `network` (`network`),
  INDEX `provider` (`provider`),
  INDEX `archive` (`archive`),
  INDEX `created` (`created`)
);
