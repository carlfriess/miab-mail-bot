/*

    Mail-in-a-Box Mail Bot
    ======================

    Manages email accounts on a Mail-in-a-Box server for Slack team members.

*/


// Load Configuration:
var config = require(__dirname + '/config.json');


var Botkit = require('botkit');
var request = require('request');
var generatePassword = require('password-generator');


// Botkit setup:
var controller = Botkit.slackbot({
    debug: false,
    json_file_store: config.storageLocation
});

// Connect to Slack:
controller.spawn({
    token: config.token
}).startRTM(function(err) {
    if (err) {
        throw new Error(err);
    }
});


// Greeting:
controller.hears(['hi', 'hallo', 'hello', 'hey', 'hoi', 'what', 'help'],
    ['direct_message', 'direct_mention'], function(bot, message) {

    bot.reply(message,"Hi there! I'm your Mail Bot and I'm here to help! :blush: " +
        "Message me and I can help you with the following:\n" +
        " - I can *create* your @" + config.miab.emailDomain + " email account.\n" +
        " - If you *forget* your email password, I can help you *reset* it.\n" +
        " - I can give you *information* about how to set up your emails and how to access " +
            "our private cloud.\n");

});

// Reply with setup information:
controller.hears(['how', 'info', 'install', 'web'],
    ['direct_message', 'direct_mention'], function(bot, message) {

    bot.startConversation(message, convo_showInformation);

});

// Respond to requests to create a new email address:
controller.hears(['create', 'add', 'new', 'neu'],['direct_message'], function(bot, message) {

    getUserEmail(message.user, function(email) {

        if (email) {
            bot.startPrivateConversation(message, function(response, convo) {
                convo.say("You already have an email address: `" + email + "`");
                convo.say("I can *reset* your password for you if you have forgotten it.");
                convo.say("If you want to delete your account or need an alias, please " +
                    "contact " + config.adminContact);
                convo.next();
            });
        }
        else {
            bot.startPrivateConversation(message, convo_createNewEmail);
        }

    });

});

// Respond to requests to reset password:
controller.hears(['reset', 'password', 'change', 'forgot', 'forget'],['direct_message'],
    function(bot, message) {

    getUserEmail(message.user, function(email) {

        if (email) {
            bot.startPrivateConversation(message, function(response, convo) {
                convo.say("I'm about to reset the password for `" + email + "`!");
                convo.ask("Are you sure about this?", [
                    {
                        pattern: convo.task.botkit.utterances.yes,
                        callback: function(response, convo) {
                            convo.say("Okay, I'm on it! :rocket:");
                            var password = generatePassword(12, false);
                            miabSetPassword(email, password, function(err, msg){

                                if (err) {
                                    convo.say("Something went wrong! :scream:");
                                    convo.say("Please contact " + config.adminContact);
                                    convo.next();
                                    return;
                                }
                                
                                convo.say("System says: ```" + msg + "```");
                                convo.say("All done! :sunglasses:");
                                convo.say("Your new password is: `" + password + "`");
                                convo.say("You can change your password at https://" +
                                    config.miab.domain + "/mail/");
                                convo.next();

                            });
                        }
                    },
                    {
                        pattern: convo.task.botkit.utterances.no,
                        callback: function(response, convo) {
                            convo.say("Okay, see you later. :wink:");
                            convo.next();
                        }
                    },
                    {
                        default: true,
                        callback: function(response, convo) {
                            convo.say("I didn't quite get that...");
                            convo.repeat();
                            convo.next();
                        }
                    }
                ]);
            });
        }
        else {
            bot.startPrivateConversation(message, function(response, convo) {
                convo.say("It looks like you don't have an email account yet.. " +
                    ":stuck_out_tongue: Ask me to create one for you, then I can reset your " +
                    "password. :smirk:");
                convo.next();
            });
        }

    });

});


// Create new email account:
var convo_createNewEmail = function(response, convo) {
    convo.say("Okay! I'm about to create a new email account for you.");
    convo.ask("Are you ready?", [
        {
            pattern: convo.task.botkit.utterances.yes,
            callback: function(response, convo) {
                convo.say("Great! Let's get started! :smiley:");
                convo_askFullName(response, convo);
                convo.next();
            }
        },
        {
            pattern: convo.task.botkit.utterances.no,
            callback: function(response, convo) {
                convo.say("Okay, I won't create a new email account.");
                convo.next();
            }
        },
        {
            default: true,
            callback: function(response, convo) {
                convo.say("I didn't quite get that...");
                convo.repeat();
                convo.next();
            }
        }
    ]);
};

// Get first and last name for email address:
var convo_askFullName = function(response, convo) {
    var email = "";
    convo.say("Your email address will have this format: " +
        "`<first name>.<last name>@" + config.miab.emailDomain + "`");
    convo.ask("What is your first name?", function(response, convo) {
        email = response.text.replace(/\W/g, '').toLowerCase();
        convo.ask("Great! What about your last name?", function(response, convo) {
            email += "." + response.text.replace(/\W/g, '').toLowerCase() + "@"
                + config.miab.emailDomain;
            miabEmailExists(email, function(exists) {
                if (exists) {
                    convo.say("I'm sorry, but `" + email + "` is already taken! :confused:");
                    convo.ask("Do you want to try again?", [
                        {
                            pattern: convo.task.botkit.utterances.yes,
                            callback: function(response, convo) {
                                convo.say("Okay!");
                                convo_askFullName(response, convo);
                                convo.next();
                            }
                        },
                        {
                            default: true,
                            callback: function(response, convo) {
                                convo.say("Later then.. You know where to find me! :wink:");
                                convo.next();
                            }
                        }
                    ]);
                    convo.next();
                }
                else {
                    convo.say("I'm about to create `" + email + "` for you!");
                    convo.ask("Is that correct?", [
                        {
                            pattern: convo.task.botkit.utterances.yes,
                            callback: function(response, convo) {
                                convo.say("Perfect! :blush: I'll do that right now!");
                                var password = generatePassword(12, false);
                                miabCreateEmail(email, password, function(err, msg){

                                    if (err) {
                                        convo.say("Something went wrong! :scream:");
                                        convo.say("Please contact " + config.adminContact);
                                        convo.next();
                                        return;
                                    }

                                    controller.storage.users.save({id: response.user,
                                        email: email}, function(err){

                                        if (err) {
                                            convo.say("Something went wrong with my storage!" +
                                                " :scream:");
                                            convo.say("Please contact " + config.adminContact);
                                            convo.next();
                                            return;
                                        }
                                        convo.say("System says: ```" + msg + "```");
                                        convo.say("All done! :sunglasses:");
                                        convo.say("Your new email address is: `" + email + "`");
                                        convo.say("Your password is: `" + password + "`");
                                        convo.say("You can change your password at https://" +
                                            config.miab.domain + "/mail/");

                                        convo_showInformation(response, convo);
                                        convo.next();

                                    });

                                });
                            }
                        },
                        {
                            default: true,
                            callback: function(response, convo) {
                                convo.ask("Do you want to try that again?", [
                                    {
                                        pattern: convo.task.botkit.utterances.yes,
                                        callback: function(response, convo) {
                                            convo.say("Okay!");
                                            convo_askFullName(response, convo);
                                            convo.next();
                                        }
                                    },
                                    {
                                        default: true,
                                        callback: function(response, convo) {
                                            convo.say("Later then.. You know where to find me!" +
                                                ":wink:");
                                            convo.next();
                                        }
                                    }
                                ]);
                                convo.next();
                            }
                        }
                    ]);
                    convo.next();
                }
            });
        });
        convo.next();
    });
};

// Show information:
var convo_showInformation = function(response, convo) {

    convo.say("So here is some information on how to get started with your email account:");

    convo.say(":mailbox_with_mail: You can access your emails via our webmail at *<https://" +
        config.miab.domain + "/mail/>*");
    convo.say("I recommend you use an email client on your computer and/or phone. :apple: On " +
        "iOS and Mac you can click <https://" + config.miab.domain + "/mailinabox.mobileconfig|" +
        "this link> and follow the instructions. Your _username_ is your full email address. " +
        "Your _password_ is the one I sent you when I set up your email account, unless you " +
        "changed it.");
    convo.say("For other devices, these are the settings you will need to manually configure " +
        "your email client:");
    convo.say(">*Protocol/Method:* IMAP\n" +
        ">*Mail server:* " + config.miab.domain + "\n" +
        ">*IMAP Port:* 993\n" +
        ">*IMAP Security:* SSL or TLS\n" +
        ">*SMTP Port:* 587\n" +
        ">*SMTP Security:* STARTTLS _(\"always\" or \"required\", if prompted)_\n" +
        ">*Username:* _Your full email address_\n" +
        ">*Password:* _The password I sent you, unless you changed it._\n");
    convo.say("For more details go to https://" + config.miab.domain + "/admin and go to " + 
        "Mail > Instructions.");
    convo.say(":rocket: You also have access to our private cloud, which you can use for " +
        "contacts, calendars and file sharing/storage.");
    convo.say("You can access it at *<https://" + config.miab.domain + "/cloud>*. Your login " +
        "is the same as for your email account.");
    convo.say(":question: If you have any issues I can't help you with, contact " +
        config.adminContact + ". :blush:");

};


// Get a users email address:
function getUserEmail(user, callback) {

    // Try to map the user ID to an email address:
    controller.storage.users.get(user, function(err, user_data) {

        if (err || !user_data || !user_data.email) {  // User does not have an email address yet.
            callback();
            return;
        }

        // Check if the email address is still valid:
        miabEmailExists(user_data.email, function(exists){

            if (exists) {   // Email is still valid:
                callback(user_data.email);
            }
            else {  // Email is no longer valid, so delete the entry in storage:

                controller.storage.users.delete(user, function(err) {

                    callback();

                });

            }

        });

    });

}

// Check if email exists in Mail-in-a-Box:
function miabEmailExists(email, callback) {

    var domain = email.split("@")[1];

    request({
        url: "https://" + config.miab.domain + "/admin/mail/users?format=json",
        method: "GET",
        auth: {
            username: config.miab.username,
            password: config.miab.password
        }
    }, function(error, response, body){

        if (error) {
            throw new Error(error);
        }

        // Parse response body:
        var domains = JSON.parse(body);

        // Find correct email domain:
        for (var i = domains.length - 1; i >= 0; i--) {
            if (domains[i].domain == domain) {

                // Look for email address:
                for (var j = domains[i].users.length - 1; j >= 0; j--) {
                    if (domains[i].users[j].email == email) {   // Found email address
                        callback(true);
                        return;
                    }
                };

                break;

            }
        };

        // Email address does not exist

        callback(false);
        
    });

}

// Create new email account in Mail-in-a-Box:
function miabCreateEmail(email, password, callback) {
    request({
        url: "https://" + config.miab.domain + "/admin/mail/users/add",
        method: "POST",
        auth: {
            username: config.miab.username,
            password: config.miab.password
        },
        form: {
            email: email,
            password: password
        }
    }, function(error, response, body) {

        callback(error, body);

    });
}

// Create new email account in Mail-in-a-Box:
function miabSetPassword(email, password, callback) {
    request({
        url: "https://" + config.miab.domain + "/admin/mail/users/password",
        method: "POST",
        auth: {
            username: config.miab.username,
            password: config.miab.password
        },
        form: {
            email: email,
            password: password
        }
    }, function(error, response, body) {

        callback(error, body);

    });
}
