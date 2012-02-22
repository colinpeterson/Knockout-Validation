/// <reference path="../Lib/knockout-latest.debug.js" />


(function () {
    if (typeof (ko) === undefined) { throw 'Knockout is required, please ensure it is loaded before loading this validation plug-in'; }

    var configuration = {
        registerExtenders: true,
        messagesOnModified: true,
        messageTemplate: null,
        insertMessages: true,
        parseInputAttributes: false,
        decorateElement: false,         //false to keep backward compatibility
        errorClass: null,               //single class for error message and element
        errorElementClass: 'validationElement',  //class to decorate error element
        errorMessageClass: 'validationMessage',  //class to decorate error message
        grouping: {
            deep: false,        //by default grouping is shallow
            observable: true    //and using observables
        }
    };

    var html5Attributes = ['required', 'pattern', 'min', 'max', 'step'];

    var async = function (expr) {
        if (window.setImmediate) { window.setImmediate(expr); }
        else { window.setTimeout(expr, 0); }
    };

    //#region Utilities

    var utils = (function () {
        var seedId = new Date().getTime();

        var domData = {}; //hash of data objects that we reference from dom elements
        var domDataKey = '__ko_validation__';

        return {
            isArray: function (o) {
                return o.isArray || Object.prototype.toString.call(o) === '[object Array]';
            },
            isObject: function (o) {
                return o !== null && typeof o === 'object';
            },
            values: function (o) {
                var r = [];
                for (var i in o) {
                    if (o.hasOwnProperty(i)) {
                        r.push(o[i]);
                    }
                }
                return r;
            },
            getValue: function (o) {
                return (typeof o === 'function' ? o() : o);
            },
            hasAttribute: function (node, attr) {
                return node.getAttribute(attr) !== null;
            },
            isValidatable: function (o) {
                return o.rules && o.isValid && o.isModified;
            },
            insertAfter: function (node, newNode) {
                node.parentNode.insertBefore(newNode, node.nextSibling);
            },
            newId: function () {
                return seedId += 1;
            },
            getConfigOptions: function (element) {
                var options = utils.contextFor(element);

                return options || configuration;
            },
            setDomData: function (node, data) {
                var key = node[domDataKey];

                if (!key) {
                    node[domDataKey] = key = utils.newId();
                }

                domData[key] = data;
            },
            getDomData: function (node) {
                var key = node[domDataKey];

                if (!key) {
                    return undefined;
                }

                return domData[key];
            },
            contextFor: function (node) {
                switch (node.nodeType) {
                    case 1:
                    case 8:
                        var context = utils.getDomData(node);
                        if (context) return context;
                        if (node.parentNode) return utils.contextFor(node.parentNode);
                        break;
                }
                return undefined;
            }
        };
    } ());

    //#endregion

    //#region Public API
    ko.validation = (function () {
        return {
            utils: utils,

            //Call this on startup
            //any config can be overridden with the passed in options
            init: function (options) {
                //becuase we will be accessing options properties it has to be an object at least
                options = options || {};
                //if specific error classes are not provided then apply generic errorClass
                //it has to be done on option so that options.errorClass can override default 
                //errorElementClass and errorMessage class but not those provided in options            
                options.errorElementClass = options.errorElementClass || options.errorClass || configuration.errorElementClass;
                options.errorMessageClass = options.errorMessageClass || options.errorClass || configuration.errorMessageClass;

                ko.utils.extend(configuration, options);

                if (configuration.registerExtenders) {
                    ko.validation.registerExtenders();
                }
            },
            //backwards compatability
            configure: function (options) { ko.validation.init(options); },

            group: function group(obj, options) { // array of observables or viewModel
                var options = ko.utils.extend(configuration.grouping, options),
                validatables = [],
                result = null,

                //anonymous, immediate function to travers objects hierarchically
                //if !options.deep then it will stop on top level
                traverse = function traverse(obj, level) {
                    var objValues = [], val = ko.utils.unwrapObservable(obj);
                    //default level value depends on deep option. 
                    level = (level !== undefined ? level : options.deep ? 1 : -1);
                    // if object is observable then add it to the list
                    if (ko.isObservable(obj)) {
                        //make sure it is validatable object
                        if (!obj.isValid) obj.extend({ validatable: true });
                        validatables.push(obj);
                    }
                    //get list of values either from array or object but ignore non-objects
                    if (val) {
                        if (utils.isArray(val)) {
                            objValues = val;
                        } else if (utils.isObject(val)) {
                            objValues = utils.values(val);
                        }
                    }
                    //process recurisvely if it is deep grouping
                    if (level !== 0) {
                        ko.utils.arrayForEach(objValues, function (observable) {
                            //but not falsy things and not HTML Elements
                            if (observable && !observable.nodeType) traverse(observable, level + 1);
                        });
                    }
                };

                //if using observables then traverse structure once and add observables
                if (options.observable) {
                    traverse(obj);
                    result = ko.dependentObservable(function () {
                        var errors = [];
                        ko.utils.arrayForEach(validatables, function (observable) {
                            if (!observable.isValid()) {
                                errors.push(observable.error);
                            }
                        });
                        return errors;
                    });

                    result.showAllMessages = function () {
                        ko.utils.arrayForEach(validatables, function (observable) {
                            observable.isModified(true);
                        });
                    };
                } else { //if not using observables then every call to error() should traverse the structure
                    result = function () {
                        var errors = [];
                        validatables = []; //clear validatables
                        traverse(obj); // and traverse tree again
                        ko.utils.arrayForEach(validatables, function (observable) {
                            if (!observable.isValid()) {
                                errors.push(observable.error);
                            }
                        });
                        return errors;
                    };

                    result.showAllMessages = function () {
                        ko.utils.arrayForEach(validatables, function (observable) {
                            observable.isModified(true);
                        });
                    };

                    obj.errors = result;
                    obj.isValid = function () {
                        return obj.errors().length === 0;
                    }
                }
                return result;
            },

            formatMessage: function (message, params) {
                return message.replace('{0}', params);
            },

            // addRule: 
            // This takes in a ko.observable and a Rule Context - which is just a rule name and params to supply to the validator
            // ie: ko.validation.addRule(myObservable, {
            //          rule: 'required',
            //          params: true
            //      });
            //
            addRule: function (observable, rule) {
                observable.extend({ validatable: true });

                //push a Rule Context to the observables local array of Rule Contexts
                observable.rules.push(rule);
                return observable;
            },

            // addAnonymousRule:
            // Anonymous Rules essentially have all the properties of a Rule, but are only specific for a certain property
            // and developers typically are wanting to add them on the fly or not register a rule with the 'ko.validation.rules' object
            //
            // Example:
            // var test = ko.observable('something').extend{(
            //      validation: {
            //          validator: function(val, someOtherVal){
            //              return true;
            //          },
            //          message: "Something must be really wrong!',
            //          params: true
            //      }
            //  )};
            addAnonymousRule: function (observable, ruleObj) {
                var ruleName = utils.newId();

                //Create an anonymous rule to reference
                ko.validation.rules[ruleName] = {
                    validator: ruleObj.validator,
                    message: ruleObj.message || 'Error'
                };

                //add the anonymous rule to the observable
                ko.validation.addRule(observable, {
                    rule: ruleName,
                    params: ruleObj.params
                });
            },

            addExtender: function (ruleName) {
                ko.extenders[ruleName] = function (observable, params) {
                    //params can come in a few flavors
                    // 1. Just the params to be passed to the validator
                    // 2. An object containing the Message to be used and the Params to pass to the validator
                    //
                    // Example:
                    // var test = ko.observable(3).extend({
                    //      max: {
                    //          message: 'This special field has a Max of {0}',
                    //          params: 2
                    //      }
                    //  )};
                    //
                    if (params.message) { //if it has a message object, then its an object literal to use
                        return ko.validation.addRule(observable, {
                            rule: ruleName,
                            message: params.message,
                            params: params.params || true
                        });
                    } else {
                        return ko.validation.addRule(observable, {
                            rule: ruleName,
                            params: params
                        });
                    }
                };
            },

            // loops through all ko.validation.rules and adds them as extenders to 
            // ko.extenders
            registerExtenders: function () { // root extenders optional, use 'validation' extender if would cause conflicts
                if (configuration.registerExtenders) {
                    for (var ruleName in ko.validation.rules) {
                        if (ko.validation.rules.hasOwnProperty(ruleName)) {
                            if (!ko.extenders[ruleName]) {
                                ko.validation.addExtender(ruleName);
                            }
                        }
                    }
                }
            },

            //creates a span next to the @element with the specified error class
            insertValidationMessage: function (element) {
                var span = document.createElement('SPAN');
                span.className = configuration.errorMessageClass;
                utils.insertAfter(element, span);
                return span;
            },

            // if html-5 validation attributes have been specified, this parses
            // the attributes on @element

            parseInputValidationAttributes: function (element, valueAccessor) {
                ko.utils.arrayForEach(html5Attributes, function (attr) {
                    if (utils.hasAttribute(element, attr)) {
                        ko.validation.addRule(valueAccessor(), {
                            rule: attr,
                            params: element.getAttribute(attr) || true
                        });
                    }
                });
            }
        };
    } ());
    //#endregion

    //#region Core Validation Rules

    //Validation Rules:
    // You can view and override messages or rules via:
    // ko.validation.rules[ruleName] 
    // 
    // To implement a custom Rule, simply use this template:
    // ko.validation.rules['<custom rule name>'] = {
    //      validator: function (val, param) {
    //          <custom logic>
    //          return <true or false>;
    //      },
    //      message: '<custom validation message>' //optionally you can also use a '{0}' to denote a placeholder that will be replaced with your 'param'
    // };
    //
    // Example:
    // ko.validation.rules['mustEqual'] = {
    //      validator: function( val, mustEqualVal ){
    //          return val === mustEqualVal;
    //      }, 
    //      message: 'This field must equal {0}'
    // };
    //
    ko.validation.rules = {};
    ko.validation.rules['required'] = {
        validator: function (val, required) {
            var stringTrimRegEx = /^\s+|\s+$/g,
                testVal;

            if (val === undefined || val === null) {
                return !required;
            }

            testVal = val;
            if (typeof (val) == "string") {
                testVal = val.replace(stringTrimRegEx, '');
            }

            return required && (testVal + '').length > 0;
        },
        message: 'This field is required.'
    };

    ko.validation.rules['min'] = {
        validator: function (val, min) {
            return !val || val >= min;
        },
        message: 'Please enter a value greater than or equal to {0}.'
    };

    ko.validation.rules['max'] = {
        validator: function (val, max) {
            return !val || val <= max;
        },
        message: 'Please enter a value less than or equal to {0}.'
    };

    ko.validation.rules['minLength'] = {
        validator: function (val, minLength) {
            return val && val.length >= minLength;
        },
        message: 'Please enter at least {0} characters.'
    };

    ko.validation.rules['maxLength'] = {
        validator: function (val, maxLength) {
            return !val || val.length <= maxLength;
        },
        message: 'Please enter no more than {0} characters.'
    };

    ko.validation.rules['pattern'] = {
        validator: function (val, regex) {
            return !val || val.match(regex) != null;
        },
        message: 'Please check this value.'
    };

    ko.validation.rules['step'] = {
        validator: function (val, step) {
            return val % step === 0;
        },
        message: 'The value must increment by {0}'
    };

    ko.validation.rules['email'] = {
        validator: function (val, validate) {
            //I think an empty email address is also a valid entry
            //if one want's to enforce entry it should be done with 'required: true'
            return (!val) || (
                validate && /^((([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+(\.([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))$/i.test(val)
            );
        },
        message: '{0} is not a proper email address'
    };

    ko.validation.rules['date'] = {
        validator: function (value, validate) {
            return validate && !/Invalid|NaN/.test(new Date(value));
        },
        message: 'Please enter a proper date'
    };

    ko.validation.rules['dateISO'] = {
        validator: function (value, validate) {
            return validate && /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(value);
        },
        message: 'Please enter a proper date'
    };

    ko.validation.rules['number'] = {
        validator: function (value, validate) {
            return validate && /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);
        },
        message: 'Please enter a number'
    };

    ko.validation.rules['digits'] = {
        validator: function (value, validate) {
            return validate && /^\d+$/.test(value);
        },
        message: 'Please enter a digit'
    };

    ko.validation.rules['phoneUS'] = {
        validator: function (phoneNumber, validate) {
            if (typeof (phoneNumber) !== 'string') { return false; }
            phoneNumber = phoneNumber.replace(/\s+/g, "");
            return validate && phoneNumber.length > 9 && phoneNumber.match(/^(1-?)?(\([2-9]\d{2}\)|[2-9]\d{2})-?[2-9]\d{2}-?\d{4}$/);
        },
        message: 'Please specify a valid phone number'
    };

    ko.validation.rules['equal'] = {
        validator: function (val, params) {
            var otherValue = params;
            return val === otherValue;
        },
        message: 'values must equal'
    };

    ko.validation.rules['notEqual'] = {
        validator: function (val, params) {
            var otherValue = params;
            return val !== otherValue;
        },
        message: 'please choose another value.'
    };

    //unique in collection
    // options are:
    //    collection: array or function returning (observable) array 
    //              in which the value has to be unique
    //    valueAccessor: function that returns value from an object stored in collection
    //              if it is null the value is compared directly
    //    external: set to true when object you are validating is automatically updating collection
    ko.validation.rules['unique'] = {
        validator: function (val, options) {
            var c = utils.getValue(options.collection),
                external = utils.getValue(options.externalValue),
                counter = 0;

            if (!val || !c) return true;

            ko.utils.arrayFilter(ko.utils.unwrapObservable(c), function (item) {
                if (val === (options.valueAccessor ? options.valueAccessor(item) : item)) counter++;
            });
            // if value is external even 1 same value in collection means the value is not unique
            return counter < (external !== undefined && val !== external ? 1 : 2);
        },
        message: 'Please make sure the value is unique.'
    };

    //#endregion

    //#region Knockout Binding Handlers
    //setup the 'init' bindingHandler override where we inject validation messages
    (function () {
        var init = ko.bindingHandlers.value.init;

        ko.bindingHandlers.value.init = function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {

            init(element, valueAccessor, allBindingsAccessor);

            var config = utils.getConfigOptions(element);

            // parse html5 input validation attributes, optional feature
            if (config.parseInputAttributes) {
                async(function () { ko.validation.parseInputValidationAttributes(element, valueAccessor) });
            }

            //if requested insert message element and apply bindings
            if (config.insertMessages && utils.isValidatable(valueAccessor())) {
                var validationMessageElement = ko.validation.insertValidationMessage(element);
                if (config.messageTemplate) {
                    ko.renderTemplate(config.messageTemplate, { field: valueAccessor() }, null, validationMessageElement, 'replaceNode');
                } else {
                    ko.applyBindingsToNode(validationMessageElement, { validationMessage: valueAccessor() });
                }
            }
            //if requested add binding to decorate element	
            if (config.decorateElement && utils.isValidatable(valueAccessor())) {
                ko.applyBindingsToNode(element, { validationElement: valueAccessor() });
            }
        };
    } ());


    ko.bindingHandlers['validationMessage'] = { // individual error message, if modified or post binding
        update: function (element, valueAccessor) {
            var obsv = valueAccessor(),
                config = utils.getConfigOptions(element);

            obsv.extend({ validatable: true });

            var errorMsgAccessor = function () {
                if (!config.messagesOnModified || obsv.isModified()) {
                    return obsv.isValid() ? null : obsv.error;
                } else {
                    return null;
                }
            };

            //toggle visibility on validation messages when validation hasn't been evaluated, or when the object isValid
            var visiblityAccessor = function () {
                return obsv.isModified() ? !obsv.isValid() : false;
            };

            ko.bindingHandlers.text.update(element, errorMsgAccessor);
            ko.bindingHandlers.visible.update(element, visiblityAccessor);
        }
    };

    ko.bindingHandlers['validationElement'] = {
        update: function (element, valueAccessor) {
            var obsv = valueAccessor();
            obsv.extend({ validatable: true }),
                config = utils.getConfigOptions(element);

            var cssSettingsAccessor = function () {
                var result = {};
                result[config.errorElementClass] = !obsv.isValid();
                return result;
            };
            //add or remove class on the element;
            ko.bindingHandlers.css.update(element, cssSettingsAccessor);
        }
    };

    // ValidationOptions:
    // This binding handler allows you to override the initial config by setting any of the options for a specific element or context of elements
    //
    // Example:
    // <div data-bind="validationOptions: { insertMessages: true, messageTemplate: 'customTemplate', errorMessageClass: 'mySpecialClass'}">
    //      <input type="text" data-bind="value: someValue"/>
    //      <input type="text" data-bind="value: someValue2"/>
    // </div>
    ko.bindingHandlers['validationOptions'] = (function () {
        return {
            init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
                var options = ko.utils.unwrapObservable(valueAccessor());
                if (options) {
                    var newConfig = ko.utils.extend({}, configuration);
                    ko.utils.extend(newConfig, options);

                    //store the validation options on the node so we can retrieve it later
                    utils.setDomData(element, newConfig);
                }
            }
        };
    } ());
    //#endregion

    //#region Knockout Extenders

    // Validation Extender:
    // This is for creating custom validation logic on the fly
    // Example:
    // var test = ko.observable('something').extend{(
    //      validation: {
    //          validator: function(val, someOtherVal){
    //              return true;
    //          },
    //          message: "Something must be really wrong!',
    //          params: true
    //      }
    //  )};
    ko.extenders['validation'] = function (observable, rules) { // allow single rule or array
        ko.utils.arrayForEach(utils.isArray(rules) ? rules : [rules], function (rule) {
            // the 'rule' being passed in here has no name to identify a core Rule,
            // so we add it as an anonymous rule
            // If the developer is wanting to use a core Rule, but use a different message see the 'addExtender' logic for examples
            ko.validation.addAnonymousRule(observable, rule);
        });
        return observable;
    };

    //This is the extender that makes a Knockout Observable also 'Validatable'
    //examples include:
    // 1. var test = ko.observable('something').extend({validatable: true});
    // this will ensure that the Observable object is setup properly to respond to rules
    // 
    // 2. test.extend({validatable: false});
    // this will remove the validation properties from the Observable object should you need to do that.
    ko.extenders['validatable'] = function (observable, enable) {
        if (enable && !utils.isValidatable(observable)) {

            observable.error = null; // holds the error message, we only need one since we stop processing validators when one is invalid

            // observable.rules:
            // ObservableArray of Rule Contexts, where a Rule Context is simply the name of a rule and the params to supply to it
            //
            // Rule Context = { rule: '<rule name>', params: '<passed in params>', message: '<Override of default Message>' }            
            observable.rules = ko.observableArray(); //holds the rule Contexts to use as part of validation

            observable.isValid = ko.computed(function () {
                var i = 0,
                    r, // the rule validator to execute
                    ctx, // the current Rule Context for the loop
                    rules = observable.rules(), //cache for iterator
                    len = rules.length, //cache for iterator
                    params = null, //cache for parameters value (as it may be provided as function or observable)
                    message = null;  //cache for message

                for (; i < len; i++) {

                    //get the Rule Context info to give to the core Rule
                    ctx = rules[i];
                    //get value of params. default param is true, eg. required = true
                    //it can be provided as value, function, observable or function returning observable
                    params = ko.utils.unwrapObservable(utils.getValue(ctx.params)) || true;
                    //get the core Rule to use for validation
                    r = ko.validation.rules[ctx.rule];

                    //Execute the validator and see if its valid
                    if (!r.validator(observable(), params)) {

                        //not valid, so format the error message and stick it in the 'error' variable
                        observable.error = ko.validation.formatMessage(ctx.message || r.message, params);
                        return false;
                    }
                }
                observable.error = null;
                return true;
            });

            observable.isModified = ko.observable(false);
            var h_change = observable.subscribe(function (newValue) {
                observable.isModified(true);
            });

            observable._disposeValidation = function () {
                //first dispose of the subscriptions
                observable.isValid.dispose();
                observable.rules.removeAll();
                observable.isModified._subscriptions['change'] = [];
                h_change.dispose();

                delete observable['rules'];
                delete observable['error'];
                delete observable['isValid'];
                delete observable['isModified'];
            };
        } else if (enable === false && utils.isValidatable(observable)) {

            if (observable._disposeValidation) {
                observable._disposeValidation();
            }
        }
        return observable;
    };

    //#endregion

    //#region Validated Observable

    ko.validatedObservable = function (initialValue) {
        if (!ko.validation.utils.isObject(initialValue)) { return ko.observable(initialValue).extend({ validatable: true }); }

        var obsv = ko.observable(initialValue);
        obsv.errors = ko.validation.group(initialValue);
        obsv.isValid = ko.computed(function () {
            return obsv.errors().length === 0;
        });

        return obsv;
    };

    //#endregion

    //#region ApplyBindingsWithValidation
    ko.applyBindingsWithValidation = function (viewModel, rootNode, options) {
        var len = arguments.length,
            node, config;

        if (len > 2) { // all parameters were passed
            node = rootNode;
            config = options;
        } else if (len < 2) {
            node = document.body;
        } else { //have to figure out if they passed in a root node or options
            if (arguments[1].nodeType) { //its a node
                node = rootNode;
            } else {
                config = arguments[1];
            }
        }

        ko.validation.init();

        if (config) { ko.validation.utils.setDomData(node, config); }

        ko.applyBindings(viewModel, rootNode);
    };
    //#endregion

})();