## Running load tests with Artillery

You can run load tests on the API using Artillery. To do so, follow these steps:

1. Clone the repository and `cd` into it.
2. Copy the `.env.example` file to `.env` and set necessary values.
3. Run `npm install` to install dependencies.
4. Install Artillery globally by running `npm install -g artillery`.
5. Run your server using `npm start`. (or other method)
6. Run `artillery run -t <your server url> ./test/load/<test-file>.yml` to run the load test. Example: `artillery run -t http://localhost:3000 ./test/load/1k.yml`
