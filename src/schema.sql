CREATE TABLE nodes (
  `url` VARCHAR(512) NOT NULL,
  `network` VARCHAR(256) NOT NULL,
  `provider` VARCHAR(256) NOT NULL,
  `requests` INT(24) NOT NULL DEFAULT '0',
  `errors` INT(24) NOT NULL DEFAULT '0',
  `duration` INT(24) NOT NULL DEFAULT '0',
  `archive` INT(1) NOT NULL DEFAULT '-1',
  `created` INT(11) NOT NULL,
  PRIMARY KEY (`url`),
  INDEX `network` (`network`),
  INDEX `provider` (`provider`),
  INDEX `archive` (`archive`),
  INDEX `created` (`created`)
);

CREATE TABLE requests (
  `network` VARCHAR(24) NOT NULL,
  `method` VARCHAR(512) NOT NULL,
  `archive` INT(1) NOT NULL,
  `cache` INT(1) NOT NULL,
  `count` INT(24) NOT NULL DEFAULT '0',
  PRIMARY KEY (`network`, `method`, `archive`, `cache`),
  INDEX `count` (`count`)
);
