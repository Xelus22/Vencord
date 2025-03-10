/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./style.css";

import { definePluginSettings } from "@api/settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, PermissionStore, Tooltip } from "@webpack/common";
import { Channel } from "discord-types/general";

import HiddenChannelLockScreen, { setChannelBeginHeaderComponent, setEmojiComponent } from "./components/HiddenChannelLockScreen";

const ChannelListClasses = findByPropsLazy("channelName", "subtitle", "modeMuted", "iconContainer");

const VIEW_CHANNEL = 1n << 10n;

enum ShowMode {
    LockIcon,
    HiddenIconWithMutedStyle
}

const settings = definePluginSettings({
    hideUnreads: {
        description: "Hide Unreads",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    showMode: {
        description: "The mode used to display hidden channels.",
        type: OptionType.SELECT,
        options: [
            { label: "Plain style with Lock Icon instead", value: ShowMode.LockIcon, default: true },
            { label: "Muted style with hidden eye icon on the right", value: ShowMode.HiddenIconWithMutedStyle },
        ],
        restartNeeded: true
    }
});

export default definePlugin({
    name: "ShowHiddenChannels",
    description: "Show channels that you do not have access to view.",
    authors: [Devs.BigDuck, Devs.AverageReactEnjoyer, Devs.D3SOX, Devs.Ven, Devs.Nuckyz, Devs.Nickyux, Devs.dzshn],
    settings,

    patches: [
        {
            // RenderLevel defines if a channel is hidden, collapsed in category, visible, etc
            find: ".CannotShow=",
            // These replacements only change the necessary CannotShow's
            replacement: [
                {
                    match: /(?<=isChannelGatedAndVisible\(this\.record\.guild_id,this\.record\.id\).+?renderLevel:)(\i)\..+?(?=,)/,
                    replace: (_, RenderLevels) => `this.category.isCollapsed?${RenderLevels}.WouldShowIfUncollapsed:${RenderLevels}.Show`
                },
                // Move isChannelGatedAndVisible renderLevel logic to the bottom to not show hidden channels in case they are muted
                {
                    match: /(?<=(if\(!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL.+?{)if\(this\.id===\i\).+?};)(if\(!\i\.\i\.isChannelGatedAndVisible\(.+?})(.+?)(?=return{renderLevel:\i\.Show.{0,40}?return \i)/,
                    replace: (_, permissionCheck, isChannelGatedAndVisibleCondition, rest) => `${rest}${permissionCheck}${isChannelGatedAndVisibleCondition}}`
                },
                {
                    match: /(?<=renderLevel:(\i\(this,\i\)\?\i\.Show:\i\.WouldShowIfUncollapsed).+?renderLevel:).+?(?=,)/,
                    replace: (_, renderLevelExpression) => renderLevelExpression
                },
                {
                    match: /(?<=activeJoinedRelevantThreads.+?renderLevel:.+?,threadIds:\i\(this.record.+?renderLevel:)(\i)\..+?(?=,)/,
                    replace: (_, RenderLevels) => `${RenderLevels}.Show`
                },
                {
                    match: /(?<=getRenderLevel=function.+?return ).+?\?(.+?):\i\.CannotShow(?=})/,
                    replace: (_, renderLevelExpressionWithoutPermCheck) => renderLevelExpressionWithoutPermCheck
                }
            ]
        },
        {
            find: "VoiceChannel, transitionTo: Channel does not have a guildId",
            replacement: [
                {
                    // Do not show confirmation to join a voice channel when already connected to another if clicking on a hidden voice channel
                    match: /(?<=getCurrentClientVoiceChannelId\((\i)\.guild_id\);if\()/,
                    replace: (_, channel) => `!$self.isHiddenChannel(${channel})&&`
                },
                {
                    // Make Discord think we are connected to a voice channel so it shows us inside it
                    match: /(?=\|\|\i\.default\.selectVoiceChannel\((\i)\.id\))/,
                    replace: (_, channel) => `||$self.isHiddenChannel(${channel})`
                },
                {
                    // Make Discord think we are connected to a voice channel so it shows us inside it
                    match: /(?<=\|\|\i\.default\.selectVoiceChannel\((\i)\.id\);!__OVERLAY__&&\()/,
                    replace: (_, channel) => `$self.isHiddenChannel(${channel})||`
                }
            ]
        },
        {
            find: "VoiceChannel.renderPopout: There must always be something to render",
            replacement: [
                // Render null instead of the buttons if the channel is hidden
                ...[
                    "renderEditButton",
                    "renderInviteButton",
                    "renderOpenChatButton"
                ].map(func => ({
                    match: new RegExp(`(?<=${func}=function\\(\\){)`, "g"), // Global because Discord has multiple declarations of the same functions
                    replace: "if($self.isHiddenChannel(this.props.channel))return null;"
                }))
            ]
        },
        {
            find: ".Messages.CHANNEL_TOOLTIP_DIRECTORY",
            predicate: () => settings.store.showMode === ShowMode.LockIcon,
            replacement: {
                // Lock Icon
                match: /(?=switch\((\i)\.type\).{0,30}\.GUILD_ANNOUNCEMENT.{0,30}\(0,\i\.\i\))/,
                replace: (_, channel) => `if($self.isHiddenChannel(${channel}))return $self.LockIcon;`
            }
        },
        {
            find: ".UNREAD_HIGHLIGHT",
            predicate: () => settings.store.showMode === ShowMode.HiddenIconWithMutedStyle,
            replacement: [
                // Make the channel appear as muted if it's hidden
                {
                    match: /(?<=\i\.name,\i=)(?=(\i)\.muted)/,
                    replace: (_, props) => `$self.isHiddenChannel(${props}.channel)?true:`
                },
                // Add the hidden eye icon if the channel is hidden
                {
                    match: /\(\).children.+?:null(?<=(\i)=\i\.channel,.+?)/,
                    replace: (m, channel) => `${m},$self.isHiddenChannel(${channel})?$self.HiddenChannelIcon():null`
                },
                // Make voice channels also appear as muted if they are muted
                {
                    match: /(?<=\.wrapper:\i\(\)\.notInteractive,)(.+?)((\i)\?\i\.MUTED)/,
                    replace: (_, otherClasses, mutedClassExpression, isMuted) => `${mutedClassExpression}:"",${otherClasses}${isMuted}?""`
                }
            ]
        },
        {
            find: ".UNREAD_HIGHLIGHT",
            replacement: [
                {
                    // Make muted channels also appear as unread if hide unreads is false, using the HiddenIconWithMutedStyle and the channel is hidden
                    predicate: () => settings.store.hideUnreads === false && settings.store.showMode === ShowMode.HiddenIconWithMutedStyle,
                    match: /\.LOCKED:\i(?<=(\i)=\i\.channel,.+?)/,
                    replace: (m, channel) => `${m}&&!$self.isHiddenChannel(${channel})`
                },
                {
                    // Hide unreads
                    predicate: () => settings.store.hideUnreads === true,
                    match: /(?<=\i\.connected,\i=)(?=(\i)\.unread)/,
                    replace: (_, props) => `$self.isHiddenChannel(${props}.channel)?false:`
                }
            ]
        },
        {
            // Hide New unreads box for hidden channels
            find: '.displayName="ChannelListUnreadsStore"',
            replacement: {
                match: /(?<=return null!=(\i))(?=.{0,130}?hasRelevantUnread\(\i\))/g, // Global because Discord has multiple methods like that in the same module
                replace: (_, channel) => `&&!$self.isHiddenChannel(${channel})`
            }
        },
        // Only render the channel header and buttons that work when transitioning to a hidden channel
        {
            find: "Missing channel in Channel.renderHeaderToolbar",
            replacement: [
                {
                    match: /(?<=renderHeaderToolbar=function.+?case \i\.\i\.GUILD_TEXT:)(?=.+?;(.+?{channel:(\i)},"notifications"\)\);))/,
                    replace: (_, pushNotificationButtonExpression, channel) => `if($self.isHiddenChannel(${channel})){${pushNotificationButtonExpression}break;}`
                },
                {
                    match: /(?<=renderHeaderToolbar=function.+?case \i\.\i\.GUILD_FORUM:if\(!\i\){)(?=.+?;(.+?{channel:(\i)},"notifications"\)\)))/,
                    replace: (_, pushNotificationButtonExpression, channel) => `if($self.isHiddenChannel(${channel})){${pushNotificationButtonExpression};break;}`
                },
                {
                    match: /renderMobileToolbar=function.+?case \i\.\i\.GUILD_FORUM:(?<=(\i)\.renderMobileToolbar.+?)/,
                    replace: (m, that) => `${m}if($self.isHiddenChannel(${that}.props.channel))break;`
                },
                {
                    match: /(?<=renderHeaderBar=function.+?hideSearch:(\i)\.isDirectory\(\))/,
                    replace: (_, channel) => `||$self.isHiddenChannel(${channel})`
                },
                {
                    match: /(?<=renderSidebar=function\(\){)/,
                    replace: "if($self.isHiddenChannel(this.props.channel))return null;"
                },
                {
                    match: /(?<=renderChat=function\(\){)/,
                    replace: "if($self.isHiddenChannel(this.props.channel))return $self.HiddenChannelLockScreen(this.props.channel);"
                }
            ]
        },
        // Avoid trying to fetch messages from hidden channels
        {
            find: '"MessageManager"',
            replacement: {
                match: /"Skipping fetch because channelId is a static route"\);else{(?=.+?getChannel\((\i)\))/,
                replace: (m, channelId) => `${m}if($self.isHiddenChannel({channelId:${channelId}}))return;`
            }
        },
        // Patch keybind handlers so you can't accidentally jump to hidden channels
        {
            find: '"alt+shift+down"',
            replacement: {
                match: /(?<=getChannel\(\i\);return null!=(\i))(?=.{0,130}?hasRelevantUnread\(\i\))/,
                replace: (_, channel) => `&&!$self.isHiddenChannel(${channel})`
            }
        },
        {
            find: '"alt+down"',
            replacement: {
                match: /(?<=getState\(\)\.channelId.{0,30}?\(0,\i\.\i\)\(\i\))(?=\.map\()/,
                replace: ".filter(ch=>!$self.isHiddenChannel(ch))"
            }
        },
        // Export the emoji component used on the lock screen
        {
            find: 'jumboable?"jumbo":"default"',
            replacement: {
                match: /jumboable\?"jumbo":"default",emojiId.+?}}\)},(?<=(\i)=function\(\i\){var \i=\i\.node.+?)/,
                replace: (m, component) => `${m}shcEmojiComponentExport=($self.setEmojiComponent(${component}),void 0),`
            }
        },
        {
            find: ".Messages.ROLE_REQUIRED_SINGLE_USER_MESSAGE",
            replacement: [
                {
                    // Export the channel beggining header
                    match: /computePermissionsForRoles.+?}\)}(?<=function (\i)\(.+?)(?=var)/,
                    replace: (m, component) => `${m}$self.setChannelBeginHeaderComponent(${component});`
                },
                {
                    // Patch the header to only return allowed users and roles if it's a hidden channel (Like when it's used on the HiddenChannelLockScreen)
                    match: /MANAGE_ROLES.{0,60}?return(?=\(.+?(\(0,\i\.jsxs\)\("div",{className:\i\(\)\.members.+?guildId:(\i)\.guild_id.+?roleColor.+?]}\)))/,
                    replace: (m, component, channel) => `${m} $self.isHiddenChannel(${channel})?${component}:`
                }
            ]
        },
        {
            find: ".Messages.SHOW_CHAT",
            replacement: [
                {
                    // Remove the divider and the open chat button for the HiddenChannelLockScreen
                    match: /"more-options-popout"\)\);if\((?<=function \i\((\i)\).+?)/,
                    replace: (m, props) => `${m}(!$self.isHiddenChannel(${props}.channel)||${props}.inCall)&&`
                },
                {
                    // Render our HiddenChannelLockScreen component instead of the main voice channel component
                    match: /this\.renderVoiceChannelEffects.+?children:(?<=renderContent=function.+?)/,
                    replace: "$&!this.props.inCall&&$self.isHiddenChannel(this.props.channel)?$self.HiddenChannelLockScreen(this.props.channel):"
                },
                {
                    // Disable gradients for the HiddenChannelLockScreen of voice channels
                    match: /this\.renderVoiceChannelEffects.+?disableGradients:(?<=renderContent=function.+?)/,
                    replace: "$&!this.props.inCall&&$self.isHiddenChannel(this.props.channel)||"
                },
                {
                    // Disable useless components for the HiddenChannelLockScreen of voice channels
                    match: /(?:{|,)render(?!Header|ExternalHeader).{0,30}?:(?<=renderContent=function.+?)(?!void)/g,
                    replace: "$&!this.props.inCall&&$self.isHiddenChannel(this.props.channel)?null:"
                }
            ]
        },
        {
            find: "Guild voice channel without guild id.",
            replacement: [
                {
                    // Render our HiddenChannelLockScreen component instead of the main stage channel component
                    match: /Guild voice channel without guild id.+?children:(?<=(\i)\.getGuildId\(\).+?)(?=.{0,20}?}\)}function)/,
                    replace: (m, channel) => `${m}$self.isHiddenChannel(${channel})?$self.HiddenChannelLockScreen(${channel}):`
                },
                {
                    // Disable useless components for the HiddenChannelLockScreen of stage channels
                    match: /render(?!Header).{0,30}?:(?<=(\i)\.getGuildId\(\).+?Guild voice channel without guild id.+?)/g,
                    replace: (m, channel) => `${m}$self.isHiddenChannel(${channel})?null:`
                },
                // Prevent Discord from replacing our route if we aren't connected to the stage channel
                {
                    match: /(?=!\i&&!\i&&!\i.{0,80}?(\i)\.getGuildId\(\).{0,50}?Guild voice channel without guild id)(?<=if\()/,
                    replace: (_, channel) => `!$self.isHiddenChannel(${channel})&&`
                },
                {
                    // Disable gradients for the HiddenChannelLockScreen of stage channels
                    match: /Guild voice channel without guild id.+?disableGradients:(?<=(\i)\.getGuildId\(\).+?)/,
                    replace: (m, channel) => `${m}$self.isHiddenChannel(${channel})||`
                },
                {
                    // Disable strange styles applied to the header for the HiddenChannelLockScreen of stage channels
                    match: /Guild voice channel without guild id.+?style:(?<=(\i)\.getGuildId\(\).+?)/,
                    replace: (m, channel) => `${m}$self.isHiddenChannel(${channel})?undefined:`
                },
                {
                    // Remove the divider and amount of users in stage channel components for the HiddenChannelLockScreen
                    match: /\(0,\i\.jsx\)\(\i\.\i\.Divider.+?}\)]}\)(?=.+?:(\i)\.guild_id)/,
                    replace: (m, channel) => `$self.isHiddenChannel(${channel})?null:(${m})`
                },
                {
                    // Remove the open chat button for the HiddenChannelLockScreen
                    match: /"recents".+?null,(?=.{0,120}?channelId:(\i)\.id)/,
                    replace: (m, channel) => `${m}!$self.isHiddenChannel(${channel})&&`
                }
            ],
        },
        {
            find: "\"^/guild-stages/(\\\\d+)(?:/)?(\\\\d+)?\"",
            replacement: {
                // Make mentions of hidden channels work
                match: /\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,\i\)/,
                replace: "true"
            },
        },
        {
            find: ".shouldCloseDefaultModals",
            replacement: {
                // Show inside voice channel instead of trying to join them when clicking on a channel mention
                match: /(?<=getChannel\((\i)\)\)(?=.{0,100}?selectVoiceChannel))/,
                replace: (_, channelId) => `&&!$self.isHiddenChannel({channelId:${channelId}})`
            }
        },
        {
            find: '.displayName="GuildChannelStore"',
            replacement: {
                // Make GuildChannelStore contain hidden channels for users in voice channels to appear in the guild tooltip
                match: /isChannelGated\(.+?\)(?=\|\|)/,
                replace: m => `${m}||true`
            }
        }
    ],

    setEmojiComponent,
    setChannelBeginHeaderComponent,

    isHiddenChannel(channel: Channel & { channelId?: string; }) {
        if (!channel) return false;

        if (channel.channelId) channel = ChannelStore.getChannel(channel.channelId);
        if (!channel || channel.isDM() || channel.isGroupDM() || channel.isMultiUserDM()) return false;

        return !PermissionStore.can(VIEW_CHANNEL, channel);
    },

    HiddenChannelLockScreen: (channel: any) => <HiddenChannelLockScreen channel={channel} />,

    LockIcon: () => (
        <svg
            className={ChannelListClasses.icon}
            height="18"
            width="20"
            viewBox="0 0 24 24"
            aria-hidden={true}
            role="img"
        >
            <path className="shc-evenodd-fill-current-color" d="M17 11V7C17 4.243 14.756 2 12 2C9.242 2 7 4.243 7 7V11C5.897 11 5 11.896 5 13V20C5 21.103 5.897 22 7 22H17C18.103 22 19 21.103 19 20V13C19 11.896 18.103 11 17 11ZM12 18C11.172 18 10.5 17.328 10.5 16.5C10.5 15.672 11.172 15 12 15C12.828 15 13.5 15.672 13.5 16.5C13.5 17.328 12.828 18 12 18ZM15 11H9V7C9 5.346 10.346 4 12 4C13.654 4 15 5.346 15 7V11Z" />
        </svg>
    ),

    HiddenChannelIcon: ErrorBoundary.wrap(() => (
        <Tooltip text="Hidden Channel">
            {({ onMouseLeave, onMouseEnter }) => (
                <svg
                    onMouseLeave={onMouseLeave}
                    onMouseEnter={onMouseEnter}
                    className={ChannelListClasses.icon + " " + "shc-hidden-channel-icon"}
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    aria-hidden={true}
                    role="img"
                >
                    <path className="shc-evenodd-fill-current-color" d="m19.8 22.6-4.2-4.15q-.875.275-1.762.413Q12.95 19 12 19q-3.775 0-6.725-2.087Q2.325 14.825 1 11.5q.525-1.325 1.325-2.463Q3.125 7.9 4.15 7L1.4 4.2l1.4-1.4 18.4 18.4ZM12 16q.275 0 .512-.025.238-.025.513-.1l-5.4-5.4q-.075.275-.1.513-.025.237-.025.512 0 1.875 1.312 3.188Q10.125 16 12 16Zm7.3.45-3.175-3.15q.175-.425.275-.862.1-.438.1-.938 0-1.875-1.312-3.188Q13.875 7 12 7q-.5 0-.938.1-.437.1-.862.3L7.65 4.85q1.025-.425 2.1-.638Q10.825 4 12 4q3.775 0 6.725 2.087Q21.675 8.175 23 11.5q-.575 1.475-1.512 2.738Q20.55 15.5 19.3 16.45Zm-4.625-4.6-3-3q.7-.125 1.288.112.587.238 1.012.688.425.45.613 1.038.187.587.087 1.162Z" />
                </svg>
            )}
        </Tooltip>
    ), { noop: true })
});
