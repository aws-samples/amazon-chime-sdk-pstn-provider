all: clean
	mkdir -p layer/nodejs
	npm install 
	npm install -D @aws-sdk/types@3.1.0
	npm run build

clean: 
	-@rm -f *~
	-@rm -f *.js
	-@rm -Rf node_modules
	-@rm -Rf cdk-outputs.json
	-@rm -Rf node_modules
	-@rm -Rf package-lock.json

