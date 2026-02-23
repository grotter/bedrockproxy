#!/bin/sh

# create bundle
git archive -o bundle.zip HEAD

aws lambda update-function-code --function-name bedrockproxy --zip-file fileb://bundle.zip --publish

# cleanup
rm bundle.zip

echo "${bold}Done deploying!${normal}"
exit 0
