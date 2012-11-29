var compose = (function () {

var exports = {};
var is_composing_message = false;

function show(tabname, focus_area) {
    if (tabname === "stream") {
        $('#private-message').hide();
        $('#stream-message').show();
        $("#stream_toggle").addClass("active");
        $("#private_message_toggle").removeClass("active");
    } else {
        $('#private-message').show();
        $('#stream-message').hide();
        $("#stream_toggle").removeClass("active");
        $("#private_message_toggle").addClass("active");
    }
    $("#send-status").removeClass(status_classes).hide();
    $('#compose').css({visibility: "visible"});
    $("#new_message_content").trigger("autosize");
    $('.message_comp').slideDown(100);
    focus_area.focus();
    focus_area.select();
}

exports.start = function (msg_type, opts) {
    if (reload.is_in_progress()) {
        return;
    }

    opts = $.extend({ message_type:     msg_type,
                      stream:           '',
                      subject:          '',
                      private_message_recipient: '',
                      message:          ''
                    }, opts);

    compose.stream_name(opts.stream);
    compose.subject(opts.subject);
    compose.recipient(opts.private_message_recipient);
    compose.message_content(opts.message);

    $('#sidebar a[href="#home"]').tab('show');

    var focus_area;
    if (opts.stream && ! opts.subject) {
        focus_area = 'subject';
    } else if (opts.stream || opts.private_message_recipient) {
        focus_area = 'new_message_content';
    }

    if (msg_type === 'stream') {
        show('stream', $("#" + (focus_area || 'stream')));
    } else {
        show('private', $("#" + (focus_area || 'private_message_recipient')));
    }

    is_composing_message = msg_type;
    $(document).trigger($.Event('compose_started.zephyr', opts));
};

exports.cancel = function () {
    compose.hide();
    is_composing_message = false;
    $(document).trigger($.Event('compose_canceled.zephyr'));
};

var send_options;

function send_message() {
    var send_status = $('#send-status');

    // TODO: this should be collapsed with the code in composebox_typeahead.js
    var recipients = compose.recipient().split(/\s*[,;]\s*/);

    var request = {client: 'website',
                   type:        compose.composing(),
                   subject:     compose.subject(),
                   content:     compose.message_content()};
    if (request.type === "private") {
        request.to = JSON.stringify(recipients);
    } else {
        request.to = compose.stream_name();
    }

    $.ajax({
        dataType: 'json', // This seems to be ignored. We still get back an xhr.
        url: '/json/send_message',
        type: 'POST',
        data: request,
        success: function (resp, statusText, xhr) {
            compose.clear();
            send_status.hide();
            is_composing_message = false;
            compose.hide();
            $("#compose-send-button").removeAttr('disabled');
        },
        error: function (xhr, error_type) {
            if (error_type !== 'timeout' && get_updates_params.reload_pending) {
                // The error might be due to the server changing
                reload.initiate({immediate: true, send_after_reload: true});
                return;
            }
            var response = "Error sending message";
            if (xhr.status.toString().charAt(0) === "4") {
                // Only display the error response for 4XX, where we've crafted
                // a nice response.
                response += ": " + $.parseJSON(xhr.responseText).msg;
            }
            send_status.removeClass(status_classes)
                       .addClass('alert-error')
                       .text(response)
                       .append($('<span />')
                           .addClass('send-status-close').html('&times;')
                           .click(function () { send_status.stop(true).fadeOut(500); }))
                       .stop(true).fadeTo(0,1);

            $("#compose-send-button").removeAttr('disabled');
        }
    });

    send_status.hide();
}

exports.finish = function () {
    if (! compose.validate()) {
        return false;
    }
    send_message();
    // TODO: Do we want to fire the event even if the send failed due
    // to a server-side error?
    $(document).trigger($.Event('compose_finished.zephyr'));
    return true;
};

$(function () {
    $("#compose form").on("submit", function (e) {
       e.preventDefault();
       compose.finish();
    });
});

exports.hide = function () {
    $('input, textarea, button').blur();
    $('.message_comp').slideUp(100,
                              function() { $('#compose').css({visibility: "hidden"});});
};

exports.clear = function () {
    $("#compose").find('input[type=text], textarea').val('');
};

exports.toggle_mode = function () {
    if (compose.composing() === 'stream') {
        // In stream tab, switch to private
        show('private', $("#private_message_recipient"));
        is_composing_message = "private";
    } else {
        show('stream', $("#stream"));
        is_composing_message = "stream";
    }
};

exports.composing = function () {
    return is_composing_message;
};

function get_or_set(fieldname) {
    // We can't hoist the assignment of 'elem' out of this lambda,
    // because the DOM element might not exist yet when get_or_set
    // is called.
    return function (newval) {
        var elem = $('#'+fieldname);
        var oldval = $.trim(elem.val());
        if (newval !== undefined) {
            elem.val(newval);
        }
        return oldval;
    };
}

exports.stream_name     = get_or_set('stream');
exports.subject         = get_or_set('subject');
exports.message_content = get_or_set('new_message_content');
exports.recipient       = get_or_set('private_message_recipient');

function compose_error(error_text, bad_input) {
    $('#send-status').removeClass(status_classes)
               .addClass('alert-error')
               .text(error_text)
               .stop(true).fadeTo(0, 1);
    $("#compose-send-button").removeAttr('disabled');
    bad_input.focus().select();
}

// *Synchronously* check if a stream exists.
// If not, displays an error and returns false.
function check_stream_for_send(stream_name) {
    var result = "error";
    $.ajax({
        type: "POST",
        url: "/json/subscriptions/exists",
        data: {'stream': stream_name},
        async: false,
        success: function (data) {
            if (!data.exists) {
                // The stream doesn't exist
                result = "does-not-exist";
                $('#send-status').removeClass(status_classes).show();
                $('#stream-dne-name').text(stream_name);
                $('#stream-dne').show();
                $("#compose-send-button").removeAttr('disabled');
                exports.hide();
                $('#create-it').focus();
            } else if (data.subscribed) {
                result = "subscribed";
            } else {
                result = "not-subscribed";
            }
            $("#home-error").hide();
        },
        error: function (xhr) {
            result = "error";
            ui.report_error("Error checking subscription", xhr, $("#home-error"));
            $("#stream").focus();
            $("#compose-send-button").removeAttr('disabled');
        }
    });
    return result;
}

function validate_stream_message() {
    var stream_name = exports.stream_name();
    if (stream_name === "") {
        compose_error("Please specify a stream", $("#stream"));
        return false;
    }

    if (exports.subject() === "") {
        compose_error("Please specify a subject", $("#subject"));
        return false;
    }

    if (!subs.have(stream_name)) {
        switch(check_stream_for_send(stream_name)) {
        case "does-not-exist":
        case "error":
            return false;
        case "subscribed":
            // You're actually subscribed to the stream, but this
            // browser window doesn't know it.
            return true;
        case "not-subscribed":
            $('#send-status').removeClass(status_classes).show();
            $('#stream-nosub-name').text(stream_name);
            $('#stream-nosub').show();
            $("#compose-send-button").removeAttr('disabled');
            exports.hide();
            $('#sub-it').focus();
            return false;
        }
    }

    return true;
}

function validate_private_message() {
    if (exports.recipient() === "") {
        compose_error("Please specify at least one recipient", $("#private_message_recipient"));
        return false;
    }

    return true;
}

exports.validate = function () {
    $("#compose-send-button").attr('disabled', 'disabled').blur();

    if (exports.message_content() === "") {
        compose_error("You have nothing to send!", $("#new_message_content"));
        return false;
    }

    if (exports.composing() === 'private') {
        return validate_private_message();
    } else {
        return validate_stream_message();
    }
};

$(function () {
    $("#new_message_content").autosize();
});

return exports;

}());
